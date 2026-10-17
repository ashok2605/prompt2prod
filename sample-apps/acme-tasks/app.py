"""Acme Tasks — a small team task tracker (Flask web UI + JSON API).

This is the demo application that the Prompt2Prod AI crew evolves. It runs on
Cloud Run; every change ships as a new tagged revision first (preview) and is
then promoted to production.
"""
import os
from datetime import datetime, timezone
from itertools import count
from threading import Lock

from flask import Flask, jsonify, render_template, request

APP_NAME = "Acme Tasks"


def utcnow_iso():
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


class TaskStore:
    """Thread-safe in-memory task storage (each Cloud Run instance has its own copy)."""

    def __init__(self):
        self._tasks = {}
        self._ids = count(1)
        self._lock = Lock()

    def seed(self):
        for title, assignee, done in [
            ("Draft Q4 roadmap", "Priya", False),
            ("Review onboarding docs", "Ravi", True),
            ("Fix flaky login test", "Mei", False),
            ("Plan team offsite", "Arjun", False),
            ("Update API reference", "Sara", True),
        ]:
            self.create(title=title, assignee=assignee, done=done)

    def list(self):
        with self._lock:
            return [dict(t) for t in self._tasks.values()]

    def get(self, task_id):
        with self._lock:
            task = self._tasks.get(task_id)
            return dict(task) if task else None

    def create(self, title, assignee=None, done=False):
        with self._lock:
            task_id = next(self._ids)
            task = {
                "id": task_id,
                "title": title,
                "assignee": assignee,
                "done": bool(done),
                "created_at": utcnow_iso(),
            }
            self._tasks[task_id] = task
            return dict(task)

    def update(self, task_id, **fields):
        with self._lock:
            task = self._tasks.get(task_id)
            if task is None:
                return None
            task.update(fields)
            return dict(task)

    def delete(self, task_id):
        with self._lock:
            return self._tasks.pop(task_id, None) is not None


def create_app():
    app = Flask(__name__)
    store = TaskStore()
    store.seed()
    app.config["STORE"] = store

    def runtime_info():
        return {
            "app": APP_NAME,
            "revision": os.environ.get("K_REVISION", "local"),
            "service": os.environ.get("K_SERVICE", "local"),
        }

    @app.get("/")
    def index():
        tasks = sorted(store.list(), key=lambda t: t["id"])
        return render_template("index.html", tasks=tasks, info=runtime_info())

    @app.get("/health")
    def health():
        return jsonify(status="ok", **runtime_info())

    @app.get("/api/tasks")
    def list_tasks():
        tasks = sorted(store.list(), key=lambda t: t["id"])
        done = request.args.get("done")
        if done is not None:
            wanted = done.lower() in ("1", "true", "yes")
            tasks = [t for t in tasks if t["done"] == wanted]
        return jsonify(tasks=tasks, count=len(tasks))

    @app.post("/api/tasks")
    def create_task():
        data = request.get_json(silent=True) or {}
        title = (data.get("title") or "").strip()
        task = store.create(title=title, assignee=data.get("assignee"))
        return jsonify(task), 201

    @app.get("/api/tasks/<int:task_id>")
    def get_task(task_id):
        task = store.get(task_id)
        if task is None:
            return jsonify(error="task not found"), 404
        return jsonify(task)

    @app.patch("/api/tasks/<int:task_id>")
    def update_task(task_id):
        data = request.get_json(silent=True) or {}
        fields = {k: data[k] for k in ("title", "assignee", "done") if k in data}
        if "done" in fields:
            fields["done"] = bool(fields["done"])
        task = store.update(task_id, **fields)
        if task is None:
            return jsonify(error="task not found"), 404
        return jsonify(task)

    @app.delete("/api/tasks/<int:task_id>")
    def delete_task(task_id):
        if not store.delete(task_id):
            return jsonify(error="task not found"), 404
        return "", 204

    return app


app = create_app()

if __name__ == "__main__":
    app.run(host="0.0.0.0", port=int(os.environ.get("PORT", 8080)), debug=True)
