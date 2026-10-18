#!/usr/bin/env python3
"""p2p — ship a change from your terminal with the Prompt2Prod AI crew.

    export P2P_INTAKE_KEY=$(gcloud secrets versions access latest --secret=prompt2prod-intake-key)
    python cli/p2p.py "Add a GET /api/version endpoint" [--mode approval] [--name Ashok]

Submits the request through the intake API and streams the crew's live log until the change is
released (Autopilot) or waiting for your approval in the dashboard. Standard library only.
"""
import argparse
import json
import os
import sys
import time
import urllib.error
import urllib.request

API = os.environ.get("P2P_API", "https://prompt2prod-82783179546.asia-south1.run.app")
KEY = os.environ.get("P2P_INTAKE_KEY")  # never hardcoded: lives in Google Cloud Secret Manager
COLORS = {"Orchestrator": 245, "Planner": 75, "Test Author": 141, "Coder": 44, "Test Runner": 77, "Reviewer": 220,
          "Builder": 208, "Deployer": 205, "Verifier": 43, "Release Manager": 99}
KIND = {"success": "✓", "warn": "!", "error": "✗", "tool": "›", "thought": "…", "info": "·"}
TERMINAL = {"deployed", "awaiting_approval", "failed", "rejected", "rolled_back", "cancelled"}


def call(method, path, body=None, headers=None):
    req = urllib.request.Request(API + path, method=method, data=json.dumps(body).encode() if body else None,
                                 headers={"Content-Type": "application/json", **(headers or {})})
    try:
        with urllib.request.urlopen(req, timeout=30) as res:
            return json.loads(res.read() or b"{}")
    except urllib.error.HTTPError as exc:
        sys.exit(f"error {exc.code}: {exc.read().decode()[:300]}")


def paint(agent, text):
    if not sys.stdout.isatty():
        return text
    return f"\033[38;5;{COLORS.get(agent, 250)}m{text}\033[0m"


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("prompt")
    parser.add_argument("--mode", choices=["autopilot", "approval"], default="autopilot")
    parser.add_argument("--name", default=os.environ.get("USER", "cli"))
    parser.add_argument("--project", default="acme-tasks")
    args = parser.parse_args()
    if not KEY:
        sys.exit("Set P2P_INTAKE_KEY first. It is stored in Google Cloud Secret Manager:\n"
                 "  export P2P_INTAKE_KEY=$(gcloud secrets versions access latest --secret=prompt2prod-intake-key)")

    created = call("POST", "/api/webhooks/intake", {"prompt": args.prompt, "mode": args.mode, "source": "api",
                                                    "projectId": args.project, "requester": f"{args.name} · CLI"},
                   {"X-Intake-Key": KEY})
    task_id = created["id"]
    print(f"🚀 task {task_id} queued · live view: https://prompt2prod.web.app/#/task/{task_id}\n")
    seen = 0
    while True:
        for ev in call("GET", f"/api/tasks/{task_id}/events")["events"]:
            if ev["seq"] <= seen:
                continue
            seen = ev["seq"]
            if ev["kind"] == "thought":
                continue
            label = paint(ev["agent"], f"{ev['agent']:>15}")
            print(f"{label} {KIND.get(ev['kind'], '·')} {ev['message']}")
        task = call("GET", f"/api/tasks/{task_id}")
        if task.get("status") in TERMINAL:
            m = task.get("metrics") or {}
            print(f"\n{task['status'].upper()} · {task.get('title') or ''}")
            if (task.get("preview") or {}).get("url"):
                print(f"preview:    {task['preview']['url']}")
            if (task.get("release") or {}).get("url"):
                print(f"production: {task['release']['url']}")
            if m:
                print(f"time {m.get('durationSec')}s · {m.get('llmCalls')} Gemini calls · ${m.get('costUsd')}")
            return
        time.sleep(1.5)


if __name__ == "__main__":
    main()
