"""Stream a task's live events to stdout until it reaches a terminal state."""
import os
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from p2p import store  # noqa: E402

TERMINAL = {"deployed", "failed", "rejected", "awaiting_approval", "rolled_back", "cancelled"}
task_id = sys.argv[1]
seen = 0
deadline = time.time() + float(sys.argv[2] if len(sys.argv) > 2 else 900)
while time.time() < deadline:
    for event in store.list_events(task_id):
        if event["seq"] > seen:
            seen = event["seq"]
            print(f"{event['seq']:3} {event['stage']:8} {event['agent']:15} {event['kind']:7} {event['message'][:170]}", flush=True)
    task = store.get_task(task_id)
    if task and task.get("status") in TERMINAL:
        print("STATUS", task["status"], "| error:", task.get("error"), "| preview:", (task.get("preview") or {}).get("url"))
        print("METRICS", task.get("metrics"))
        stages = task.get("stages") or {}
        for key in ("sandbox", "plan", "tests", "code", "test", "review", "build", "preview", "verify", "release"):
            s = stages.get(key) or {}
            dur = (s["endedAt"] - s["startedAt"]).total_seconds() if s.get("endedAt") and s.get("startedAt") else None
            print(f"  {key:8} {s.get('status')!s:8} {dur!s:>6}s {s.get('summary', '')}")
        break
    time.sleep(4)
