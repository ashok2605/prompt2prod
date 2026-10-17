"""Capture crisp screenshots of the live dashboard for the pitch deck.

    python deck/capture_shots.py <task_id>
"""
import pathlib
import sys

from playwright.sync_api import sync_playwright

BASE = "https://prompt2prod.web.app/"
OUT = pathlib.Path(__file__).parent / "shots"
TASK = sys.argv[1]


def main():
    OUT.mkdir(exist_ok=True)
    with sync_playwright() as pw:
        browser = pw.chromium.launch()
        page = browser.new_context(viewport={"width": 1440, "height": 900}, device_scale_factor=2,
                                   color_scheme="dark").new_page()
        shots = [
            ("command-center", "", 5000),
            ("task-diff", f"#/task/{TASK}/diff", 5000),
            ("task-tests", f"#/task/{TASK}/tests", 4000),
            ("task-review", f"#/task/{TASK}/review", 4000),
            ("task-preview", f"#/task/{TASK}/preview", 9000),
            ("task-verify", f"#/task/{TASK}/verify", 5000),
            ("insights", "#/insights", 5000),
            ("releases", "#/releases", 5000),
            ("integrations", "#/integrations", 4000),
        ]
        for name, route, wait in shots:
            page.goto(BASE + route, wait_until="load")
            page.wait_for_timeout(wait)
            page.screenshot(path=str(OUT / f"{name}.png"))
            print("captured", name)
        browser.close()


if __name__ == "__main__":
    main()
