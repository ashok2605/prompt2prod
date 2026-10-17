"""Drive the live dashboard through a real Prompt2Prod run and record it (DevTools screencast).

Markers are placed when the real pipeline stages complete (read from Firestore), so the edit and the
narration line up with what actually happened.

    python video/record_demo.py "<prompt>"
"""
import json
import os
import pathlib
import sys
import time

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1] / "backend"))

from playwright.sync_api import sync_playwright  # noqa: E402

from p2p import store  # noqa: E402
from recorder import Screencast  # noqa: E402

DASHBOARD = os.environ.get("DASHBOARD_URL", "https://prompt2prod.web.app/")
APP_URL = "https://acme-tasks-82783179546.asia-south1.run.app/"
OUT = pathlib.Path(__file__).parent / "build" / "raw"
SHOTS = pathlib.Path(__file__).resolve().parents[1] / "deck" / "shots"
PROMPT = sys.argv[1] if len(sys.argv) > 1 else (
    "Add a priority field (low / medium / high, default medium) to tasks. Validate it in the API "
    "(400 with a helpful error for invalid values) and show it as a colored badge next to each task."
)


def click_tab(page, name):
    for loc in (page.get_by_role("tab", name=name), page.get_by_role("button", name=name, exact=True)):
        try:
            if loc.count():
                loc.first.click(timeout=2000)
                return True
        except Exception:  # noqa: BLE001
            continue
    return False


def smooth_scroll(page, selector, dy, steps=12, pause=60):
    for _ in range(steps):
        page.evaluate("([s, d]) => { const el = s ? document.querySelector(s) : document.scrollingElement;"
                      " if (el) el.scrollBy({top: d}); }", [selector, dy / steps])
        page.wait_for_timeout(pause)


def main():
    if OUT.exists():
        for f in OUT.iterdir():
            f.unlink()
    with sync_playwright() as pw:
        browser = pw.chromium.launch(args=["--hide-scrollbars", "--force-color-profile=srgb"])
        context = browser.new_context(viewport={"width": 1440, "height": 810}, device_scale_factor=1.3334,
                                      color_scheme="dark")
        page = context.new_page()
        page.goto(DASHBOARD, wait_until="load")
        page.wait_for_timeout(3500)
        cast = Screencast(page, OUT)
        cast.start()
        cast.wait(1.0)
        cast.mark("home")
        # gentle look around the command center while the problem statement is narrated
        smooth_scroll(page, None, 420, steps=30, pause=90)
        cast.wait(1.5)
        smooth_scroll(page, None, -420, steps=30, pause=90)
        cast.wait(1.0)

        name = page.get_by_placeholder("e.g. Ashok")
        if name.count():
            name.first.fill("Ashok")
        box = page.locator("textarea").first
        box.click()
        cast.mark("typing_start")
        box.type(PROMPT, delay=28)
        cast.wait(0.8)
        autopilot = page.get_by_role("radio", name="Autopilot")
        if autopilot.count():
            autopilot.first.click()
        cast.wait(0.8)
        page.get_by_role("button", name="Ship it").first.click()
        cast.mark("submitted")

        page.wait_for_url("**/#/task/**", timeout=30000)
        task_id = page.url.rsplit("/", 1)[-1]
        print("task", task_id, flush=True)
        seen = set()
        tab_for = {"plan": "Overview", "tests": "Tests", "code": "Diff", "review": "Review",
                   "preview": "Live preview", "verify": "Verify"}
        deadline = time.time() + 900
        while time.time() < deadline:
            task = store.get_task(task_id) or {}
            stages = task.get("stages") or {}
            for key in ("sandbox", "plan", "tests", "code", "test", "review", "build", "preview", "verify"):
                if key not in seen and (stages.get(key) or {}).get("status") in ("done", "failed"):
                    seen.add(key)
                    cast.mark(f"{key}_done")
                    if key in tab_for:
                        click_tab(page, tab_for[key])
                    if key == "code":
                        SHOTS.mkdir(exist_ok=True)
                        page.wait_for_timeout(600)
                        page.screenshot(path=str(SHOTS / "task-live.png"))
            if task.get("status") in ("deployed", "awaiting_approval", "failed", "rejected"):
                cast.mark("released" if task["status"] == "deployed" else f"ended_{task['status']}")
                break
            cast.wait(1.0)
        cast.wait(2.0)

        # inspect: diff → tests → review, then the feature live in production
        cast.mark("inspect_start")
        for tab, pause in (("Diff", 3.5), ("Tests", 3.0), ("Review", 3.0)):
            click_tab(page, tab)
            cast.wait(pause)
        page.goto(APP_URL, wait_until="networkidle")
        cast.restart()
        cast.wait(4.5)
        cast.mark("inspect_done")

        # control: approval mode + one-click rollback
        page.goto(DASHBOARD + f"#/task/{task_id}", wait_until="load")
        cast.restart()
        cast.wait(2.5)
        cast.mark("control_start")
        rollback = page.get_by_role("button", name="Roll back")
        if rollback.count():
            rollback.first.click()
            cast.wait(1.0)
            confirm = page.get_by_role("button", name="Confirm rollback")
            if confirm.count():
                confirm.first.click()
            else:
                rollback.first.click()
            deadline = time.time() + 120
            while time.time() < deadline and (store.get_task(task_id) or {}).get("status") != "rolled_back":
                cast.wait(1.0)
            cast.wait(2.5)
        cast.mark("rollback_done")

        # insights
        page.goto(DASHBOARD + "#/insights", wait_until="load")
        cast.restart()
        cast.wait(2.0)
        cast.mark("insights")
        smooth_scroll(page, None, 500, steps=40, pause=110)
        cast.wait(2.0)
        cast.mark("insights_done")
        cast.stop()
        browser.close()
    (OUT / "task.json").write_text(json.dumps({"task": task_id}))


if __name__ == "__main__":
    main()
