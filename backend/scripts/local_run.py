"""Local driver: create a task and run the full pipeline in-process (uses your ADC)."""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from p2p import store  # noqa: E402
from p2p.runner import run_for_task  # noqa: E402

prompt = sys.argv[1]
mode = sys.argv[2] if len(sys.argv) > 2 else "autopilot"
task_id = store.new_task_id()
store.create_task({
    "id": task_id, "projectId": "acme-tasks", "prompt": prompt, "title": None, "mode": mode,
    "source": "api", "requestedBy": {"uid": "local", "name": "Ashok"}, "status": "queued",
    "stage": "queued", "stages": {}, "tests": {"attempts": [], "newTests": 0}, "metrics": {},
})
store.EventLog(task_id).emit("queued", "Orchestrator", "info", f"Request received from Ashok via api · mode: {mode}")
print("TASK", task_id, flush=True)
run_for_task(task_id, holder=f"local-{task_id}")
t = store.get_task(task_id)
print("STATUS", t["status"], "| title:", t.get("title"), "| preview:", (t.get("preview") or {}).get("url"))
print("METRICS", t.get("metrics"))
print("REVIEW", (t.get("review") or {}).get("score"), (t.get("review") or {}).get("verdict"))
print("VERIFY", (t.get("verify") or {}).get("passed"), [(c["name"], c["ok"], c["detail"]) for c in (t.get("verify") or {}).get("checks", [])])
