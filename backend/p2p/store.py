"""Firestore persistence: projects, tasks, the live agent event stream and locks."""
import random
import string
import threading
from datetime import datetime, timedelta, timezone

from google.cloud import firestore
from google.cloud.firestore_v1.base_query import FieldFilter

from . import config

_db = None
_db_lock = threading.Lock()


def db():
    global _db
    with _db_lock:
        if _db is None:
            _db = firestore.Client(project=config.PROJECT_ID)
    return _db


def utcnow():
    return datetime.now(timezone.utc)


def new_task_id():
    # starts with a letter so it is valid inside Cloud Run revision names and tags
    return random.choice(string.ascii_lowercase) + "".join(
        random.choice(string.ascii_lowercase + string.digits) for _ in range(5)
    )


def tasks():
    return db().collection("tasks")


def projects():
    return db().collection("projects")


def get_task(task_id):
    snap = tasks().document(task_id).get()
    return snap.to_dict() if snap.exists else None


def get_project(project_id):
    snap = projects().document(project_id).get()
    return snap.to_dict() if snap.exists else None


def list_projects():
    return [s.to_dict() for s in projects().stream()]


def create_task(task):
    task.setdefault("createdAt", utcnow())
    task["updatedAt"] = utcnow()
    tasks().document(task["id"]).set(task)
    return task


def update_task(task_id, data):
    data = dict(data)
    data["updatedAt"] = utcnow()
    tasks().document(task_id).update(data)


def update_project(project_id, data):
    data = dict(data)
    data["updatedAt"] = utcnow()
    projects().document(project_id).set(data, merge=True)


def list_tasks(limit=50, include_diff=False):
    query = tasks().order_by("createdAt", direction=firestore.Query.DESCENDING).limit(limit)
    out = []
    for snap in query.stream():
        task = snap.to_dict()
        if not include_diff:
            task.pop("diff", None)
            if isinstance(task.get("tests"), dict):
                task["tests"].pop("output", None)
        out.append(task)
    return out


def tasks_since(since):
    query = tasks().where(filter=FieldFilter("createdAt", ">=", since))
    return [s.to_dict() for s in query.stream()]


def list_events(task_id):
    query = tasks().document(task_id).collection("events").order_by("seq")
    return [s.to_dict() for s in query.stream()]


class EventLog:
    """Append-only live log for one task (tasks/{id}/events), ordered by `seq`."""

    def __init__(self, task_id, start_seq=0):
        self.task_id = task_id
        self.seq = start_seq
        self._lock = threading.Lock()

    @classmethod
    def resume(cls, task_id):
        last = list(
            tasks().document(task_id).collection("events")
            .order_by("seq", direction=firestore.Query.DESCENDING).limit(1).stream()
        )
        return cls(task_id, last[0].to_dict().get("seq", 0) if last else 0)

    def emit(self, stage, agent, kind, message, detail=None):
        with self._lock:
            self.seq += 1
            seq = self.seq
        doc = {
            "seq": seq,
            "ts": utcnow(),
            "stage": stage,
            "agent": agent,
            "kind": kind,
            "message": str(message)[:600],
        }
        if detail:
            doc["detail"] = str(detail)[:12000]
        try:
            tasks().document(self.task_id).collection("events").document(f"{seq:05d}").set(doc)
        except Exception as exc:  # the live log must never break the pipeline
            print(f"[{self.task_id}] event write failed: {exc}", flush=True)
        print(f"[{self.task_id}] {stage:8} {agent:15} {kind:7} {str(message)[:180]}", flush=True)


# ---------------------------------------------------------------- locks

def acquire_lock(name, holder, ttl_sec=1800):
    ref = db().collection("locks").document(name)

    @firestore.transactional
    def txn(transaction):
        snap = ref.get(transaction=transaction)
        now = utcnow()
        if snap.exists:
            data = snap.to_dict()
            if data.get("holder") != holder and data.get("expiresAt") and data["expiresAt"] > now:
                return False
        transaction.set(ref, {"holder": holder, "acquiredAt": now, "expiresAt": now + timedelta(seconds=ttl_sec)})
        return True

    return txn(db().transaction())


def release_lock(name, holder):
    ref = db().collection("locks").document(name)

    @firestore.transactional
    def txn(transaction):
        snap = ref.get(transaction=transaction)
        if snap.exists and snap.to_dict().get("holder") == holder:
            transaction.delete(ref)

    txn(db().transaction())


def lock_active(name):
    snap = db().collection("locks").document(name).get()
    return bool(snap.exists and snap.to_dict().get("expiresAt", utcnow()) > utcnow())


def queued_tasks(project_id=None):
    snaps = tasks().where(filter=FieldFilter("status", "==", "queued")).stream()
    items = [s.to_dict() for s in snaps]
    if project_id:
        items = [t for t in items if t.get("projectId") == project_id]
    return sorted(items, key=lambda t: t.get("createdAt") or utcnow())


def claim_task(task_id, holder):
    """Atomically move a task from queued -> running. Returns the task or None."""
    ref = tasks().document(task_id)

    @firestore.transactional
    def txn(transaction):
        snap = ref.get(transaction=transaction)
        if not snap.exists or snap.to_dict().get("status") != "queued":
            return None
        now = utcnow()
        transaction.update(ref, {"status": "running", "stage": "sandbox", "startedAt": now,
                                 "updatedAt": now, "runner": holder})
        task = snap.to_dict()
        task.update(status="running", stage="sandbox", startedAt=now)
        return task

    return txn(db().transaction())


def jsonable(value):
    """Convert Firestore values (datetimes etc.) into JSON-friendly structures."""
    if isinstance(value, dict):
        return {k: jsonable(v) for k, v in value.items()}
    if isinstance(value, (list, tuple)):
        return [jsonable(v) for v in value]
    if isinstance(value, datetime):
        return value.isoformat()
    return value
