"""Agent runner: entrypoint of the `prompt2prod-runner` Cloud Run Job (one execution per request).

Each execution takes a per-project lock and drains that project's queue in FIFO order, so
changes to one codebase are always built on top of the latest production commit.
"""
import asyncio
import os
import uuid

from . import store
from .pipeline import Pipeline


def process_queue(project_id, holder):
    lock = f"project-{project_id}"
    for _ in range(3):
        if not store.acquire_lock(lock, holder):
            print(f"[runner {holder}] {project_id} is busy; the active runner will pick the task up", flush=True)
            return
        try:
            while True:
                queued = store.queued_tasks(project_id)
                if not queued:
                    break
                task = store.claim_task(queued[0]["id"], holder)
                if task:
                    store.acquire_lock(lock, holder)  # refresh the lease
                    asyncio.run(Pipeline(task, runner_id=holder).run())
        finally:
            store.release_lock(lock, holder)
        if not store.queued_tasks(project_id):
            return


def run_for_task(task_id, holder=None):
    holder = holder or os.environ.get("CLOUD_RUN_EXECUTION") or f"local-{uuid.uuid4().hex[:6]}"
    task = store.get_task(task_id)
    if not task:
        print(f"[runner] task {task_id} not found", flush=True)
        return
    process_queue(task["projectId"], holder)


def main():
    task_id = os.environ.get("TASK_ID")
    if not task_id:
        raise SystemExit("TASK_ID is required")
    run_for_task(task_id)


if __name__ == "__main__":
    main()
