"""Prompt2Prod API (Cloud Run service): intake, approvals, releases, metrics + the dashboard."""
import hmac
import os
import threading
import time
from collections import defaultdict, deque
from datetime import timedelta
from typing import Literal, Optional

import firebase_admin
from fastapi import Depends, FastAPI, Header, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from firebase_admin import auth as fb_auth
from pydantic import BaseModel, Field

from . import cloud, config, metrics, release, store

firebase_admin.initialize_app(options={"projectId": config.PROJECT_ID})

app = FastAPI(title="Prompt2Prod API", version=config.VERSION,
              description="Turn developer requests into tested, deployed changes with an AI crew on Google Cloud.")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])

STATIC_DIR = os.environ.get("STATIC_DIR", os.path.join(os.path.dirname(__file__), "..", "static"))
STALE_AFTER = timedelta(minutes=25)
_ip_hits = defaultdict(deque)


# ---------------------------------------------------------------- auth & limits

def current_user(authorization: Optional[str] = Header(default=None)):
    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(401, "Sign-in required (Firebase ID token missing)")
    try:
        return fb_auth.verify_id_token(authorization.split(" ", 1)[1], clock_skew_seconds=10)
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(401, f"Invalid Firebase ID token: {exc}") from exc


def display_name(user, fallback=None):
    return (fallback or user.get("name") or user.get("email") or "Developer").strip()[:40]


def enforce_limits(uid=None):
    now = store.utcnow()
    today = store.tasks_since(now - timedelta(hours=24))
    if len(today) >= config.LIMIT_PER_DAY:
        raise HTTPException(429, f"Daily demo budget reached ({config.LIMIT_PER_DAY} requests/24h). Try again later.")
    if uid:
        mine = [t for t in today if (t.get("requestedBy") or {}).get("uid") == uid
                and t["createdAt"] >= now - timedelta(hours=1)]
        if len(mine) >= config.LIMIT_PER_USER_PER_HOUR:
            raise HTTPException(429, f"Rate limit: {config.LIMIT_PER_USER_PER_HOUR} requests per hour per user.")


def enforce_ip_limit(request: Request, per_hour=10):
    ip = (request.headers.get("x-forwarded-for") or request.client.host or "?").split(",")[0].strip()
    hits = _ip_hits[ip]
    cutoff = time.time() - 3600
    while hits and hits[0] < cutoff:
        hits.popleft()
    if len(hits) >= per_hour:
        raise HTTPException(429, "Rate limit exceeded for this client.")
    hits.append(time.time())


def reap_stale_tasks():
    """Mark tasks whose runner died as failed so the queue never wedges."""
    cutoff = store.utcnow() - STALE_AFTER
    for task in store.list_tasks(limit=30):
        if task.get("status") == "running" and task.get("updatedAt") and task["updatedAt"] < cutoff:
            store.update_task(task["id"], {"status": "failed", "error": "Runner timed out", "finishedAt": store.utcnow()})


# ---------------------------------------------------------------- dispatch

def dispatch(task_id):
    if config.EXECUTION_MODE == "job":
        try:
            execution = cloud.run_runner_job(task_id)
            store.EventLog.resume(task_id).emit(
                "queued", "Orchestrator", "info",
                f"Provisioning an isolated sandbox: Cloud Run Job execution {execution or ''}".strip())
            return
        except Exception as exc:  # noqa: BLE001 — fall back to in-process execution
            store.EventLog.resume(task_id).emit("queued", "Orchestrator", "warn",
                                                f"Cloud Run Job unavailable ({exc}); running in-process")
    from .runner import run_for_task  # noqa: WPS433 — lazy import keeps the API cold start small

    threading.Thread(target=run_for_task, args=(task_id, f"inline-{task_id}"), daemon=True).start()


def new_task(project_id, prompt, mode, source, uid, name):
    if not store.get_project(project_id):
        raise HTTPException(404, f"Unknown project {project_id}")
    task_id = store.new_task_id()
    store.create_task({
        "id": task_id,
        "projectId": project_id,
        "prompt": prompt.strip(),
        "title": None,
        "mode": mode,
        "source": source,
        "requestedBy": {"uid": uid, "name": name},
        "status": "queued",
        "stage": "queued",
        "stages": {},
        "tests": {"attempts": [], "newTests": 0},
        "metrics": {},
    })
    store.EventLog(task_id).emit("queued", "Orchestrator", "info",
                                 f"Request received from {name} via {source} · mode: {mode}")
    dispatch(task_id)
    return task_id


# ---------------------------------------------------------------- models

class TaskIn(BaseModel):
    projectId: str = "acme-tasks"
    prompt: str = Field(min_length=8, max_length=2000)
    mode: Literal["autopilot", "approval"] = "autopilot"
    source: Literal["dashboard", "voice", "api", "webhook"] = "dashboard"
    requesterName: Optional[str] = None


class IntakeIn(BaseModel):
    prompt: str = Field(min_length=8, max_length=2000)
    projectId: str = "acme-tasks"
    mode: Literal["autopilot", "approval"] = "approval"
    source: Literal["api", "webhook"] = "webhook"
    requester: Optional[str] = None


# ---------------------------------------------------------------- routes

@app.get("/api/health")
def health():
    return {"status": "ok", "version": config.VERSION, "executionMode": config.EXECUTION_MODE}


@app.get("/api/config")
def get_config():
    return {
        "firebase": config.firebase_web_config(),
        "projects": store.jsonable(store.list_projects()),
        "limits": {"perUserPerHour": config.LIMIT_PER_USER_PER_HOUR, "perDay": config.LIMIT_PER_DAY},
        "models": config.MODELS,
        "region": config.REGION,
        "intakeEnabled": bool(config.intake_key()),
        "version": config.VERSION,
    }


@app.post("/api/tasks", status_code=201)
def create_task(body: TaskIn, user=Depends(current_user)):
    reap_stale_tasks()
    enforce_limits(user["uid"])
    task_id = new_task(body.projectId, body.prompt, body.mode, body.source, user["uid"],
                       display_name(user, body.requesterName))
    return {"id": task_id}


@app.get("/api/tasks")
def list_tasks(limit: int = 50):
    return {"tasks": store.jsonable(store.list_tasks(limit=min(limit, 100)))}


@app.get("/api/tasks/{task_id}")
def get_task(task_id: str):
    task = store.get_task(task_id)
    if not task:
        raise HTTPException(404, "Task not found")
    return store.jsonable(task)


@app.get("/api/tasks/{task_id}/events")
def get_events(task_id: str):
    return {"events": store.jsonable(store.list_events(task_id))}


def _task_or_404(task_id):
    task = store.get_task(task_id)
    if not task:
        raise HTTPException(404, "Task not found")
    return task


@app.get("/api/tasks/{task_id}/screenshot", include_in_schema=False)
def screenshot(task_id: str):
    from fastapi.responses import Response  # noqa: WPS433

    from . import gitrepo  # noqa: WPS433

    if not task_id.isalnum():
        raise HTTPException(404, "Not found")
    blob = gitrepo.bucket().blob(f"screenshots/{task_id}.png")
    try:
        data = blob.download_as_bytes()
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(404, "No screenshot for this task") from exc
    return Response(content=data, media_type="image/png", headers={"Cache-Control": "public, max-age=86400"})


@app.post("/api/tasks/{task_id}/approve")
def approve(task_id: str, user=Depends(current_user), x_requester_name: Optional[str] = Header(default=None)):
    task = _task_or_404(task_id)
    if task.get("status") != "awaiting_approval":
        raise HTTPException(409, f"Task is {task.get('status')}, not awaiting approval")
    name = display_name(user, x_requester_name)
    log = store.EventLog.resume(task_id)
    log.emit("release", "Release Manager", "info", f"Approved by {name} — promoting to production")
    try:
        result = release.promote(task, name, log)
    except release.ReleaseError as exc:
        log.emit("release", "Release Manager", "error", str(exc))
        raise HTTPException(409, str(exc)) from exc
    return {"ok": True, "release": store.jsonable(result)}


@app.post("/api/tasks/{task_id}/reject")
def reject(task_id: str, user=Depends(current_user), x_requester_name: Optional[str] = Header(default=None)):
    task = _task_or_404(task_id)
    if task.get("status") != "awaiting_approval":
        raise HTTPException(409, f"Task is {task.get('status')}")
    name = display_name(user, x_requester_name)
    store.update_task(task_id, {"status": "rejected", "stages.release": {"status": "failed", "summary": f"rejected by {name}"}})
    store.EventLog.resume(task_id).emit("release", "Release Manager", "warn", f"Rejected by {name}; production unchanged")
    return {"ok": True}


@app.post("/api/tasks/{task_id}/rollback")
def rollback(task_id: str, user=Depends(current_user), x_requester_name: Optional[str] = Header(default=None)):
    task = _task_or_404(task_id)
    try:
        result = release.rollback(task, display_name(user, x_requester_name))
    except release.ReleaseError as exc:
        raise HTTPException(409, str(exc)) from exc
    return {"ok": True, "release": store.jsonable(result)}


@app.post("/api/tasks/{task_id}/retry", status_code=201)
def retry(task_id: str, user=Depends(current_user), x_requester_name: Optional[str] = Header(default=None)):
    task = _task_or_404(task_id)
    enforce_limits(user["uid"])
    new_id = new_task(task["projectId"], task["prompt"], task.get("mode", "autopilot"), task.get("source", "dashboard"),
                      user["uid"], display_name(user, x_requester_name))
    return {"id": new_id}


@app.post("/api/tasks/{task_id}/cancel")
def cancel(task_id: str, user=Depends(current_user)):
    task = _task_or_404(task_id)
    if task.get("status") != "queued":
        raise HTTPException(409, "Only queued tasks can be cancelled")
    store.update_task(task_id, {"status": "cancelled", "finishedAt": store.utcnow()})
    return {"ok": True}


@app.get("/api/metrics")
def get_metrics():
    tasks = store.tasks_since(store.utcnow() - timedelta(days=14))
    return metrics.compute(tasks, store.list_projects())


@app.post("/api/projects/{project_id}/reset")
def reset_project(project_id: str, user=Depends(current_user), x_requester_name: Optional[str] = Header(default=None)):
    project = store.get_project(project_id)
    if not project:
        raise HTTPException(404, "Unknown project")
    last = [r for r in (project.get("releases") or []) if r.get("kind") == "reset"]
    if last and last[-1]["at"] > store.utcnow() - timedelta(minutes=2):
        raise HTTPException(429, "The demo was reset moments ago.")
    if store.lock_active(f"project-{project_id}"):
        raise HTTPException(409, "A change is being shipped right now; reset when it finishes.")
    try:
        result = release.reset_project(project_id, display_name(user, x_requester_name))
    except release.ReleaseError as exc:
        raise HTTPException(409, str(exc)) from exc
    return {"ok": True, **result}


@app.post("/api/webhooks/intake", status_code=201)
def intake(body: IntakeIn, request: Request, x_intake_key: Optional[str] = Header(default=None)):
    expected = config.intake_key()
    if not expected:
        raise HTTPException(503, "Intake is not configured")
    if not x_intake_key or not hmac.compare_digest(x_intake_key, expected):
        raise HTTPException(401, "Invalid X-Intake-Key")
    enforce_ip_limit(request)
    enforce_limits()
    task_id = new_task(body.projectId, body.prompt, body.mode, body.source, "webhook",
                       (body.requester or "API client")[:40])
    return {"id": task_id, "dashboard": f"/#/task/{task_id}"}


@app.exception_handler(Exception)
async def unhandled(_request: Request, exc: Exception):
    return JSONResponse(status_code=500, content={"detail": f"Internal error: {exc}"})


# ---------------------------------------------------------------- dashboard (SPA)

if os.path.isdir(STATIC_DIR):
    app.mount("/assets", StaticFiles(directory=os.path.join(STATIC_DIR, "assets"), check_dir=False), name="assets")

    @app.get("/{path:path}", include_in_schema=False)
    def spa(path: str):
        candidate = os.path.realpath(os.path.join(STATIC_DIR, path))
        if path and candidate.startswith(os.path.realpath(STATIC_DIR)) and os.path.isfile(candidate):
            return FileResponse(candidate)
        return FileResponse(os.path.join(STATIC_DIR, "index.html"))
