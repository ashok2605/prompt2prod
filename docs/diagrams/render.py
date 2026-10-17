"""Render the HTML diagrams to PNG (1600x900 @2x) with headless Chromium."""
import pathlib
import sys

from playwright.sync_api import sync_playwright

here = pathlib.Path(__file__).parent
names = sys.argv[1:] or ["architecture", "process"]
with sync_playwright() as pw:
    browser = pw.chromium.launch()
    heights = {"process": 720}
    for name in names:
        page = browser.new_page(viewport={"width": 1600, "height": heights.get(name, 900)}, device_scale_factor=2)
        page.goto((here / f"{name}.html").resolve().as_uri())
        page.wait_for_timeout(1200)
        page.screenshot(path=str(here / f"{name}.png"))
        print("rendered", name)
    browser.close()
