"""Wait until the given tasks all reach a terminal state; print a one-line summary for each."""
import os
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from p2p import store  # noqa: E402

TERMINAL = {"deployed", "failed", "rejected", "awaiting_approval", "rolled_back", "cancelled"}
ids = sys.argv[1:]
done = {}
deadline = time.time() + 3600
while len(done) < len(ids) and time.time() < deadline:
    for task_id in ids:
        if task_id in done:
            continue
        task = store.get_task(task_id)
        if task and task.get("status") in TERMINAL:
            m = task.get("metrics") or {}
            done[task_id] = task
            print(f"{task_id} {task['status']:18} lead={m.get('leadTimeSec')}s dur={m.get('durationSec')}s "
                  f"cost=${m.get('costUsd')} calls={m.get('llmCalls')} tests={(task.get('tests') or {}).get('passed')}/"
                  f"{(task.get('tests') or {}).get('total')} review={(task.get('review') or {}).get('score')} "
                  f"verify={(task.get('verify') or {}).get('passed')} title={task.get('title')!r} err={task.get('error')}",
                  flush=True)
    time.sleep(10)
