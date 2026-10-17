"""High-quality page recording via the Chrome DevTools screencast (JPEG frames + wall-clock timestamps).

Frames are only emitted when the page repaints, so each frame carries its own timestamp and the
assembler turns them into a constant-frame-rate video. `mark(name)` stores named moments used to
cut scenes and align narration.
"""
import base64
import json
import pathlib
import time


class Screencast:
    def __init__(self, page, outdir, quality=88, size=(1920, 1080)):
        self.page = page
        self.dir = pathlib.Path(outdir)
        self.dir.mkdir(parents=True, exist_ok=True)
        self.quality = quality
        self.size = size
        self.frames = []
        self.markers = {}
        self.cdp = None
        self._attach()

    def _attach(self):
        self.cdp = self.page.context.new_cdp_session(self.page)
        self.cdp.on("Page.screencastFrame", self._on_frame)

    def _on_frame(self, params):
        path = self.dir / f"f{len(self.frames):06d}.jpg"
        path.write_bytes(base64.b64decode(params["data"]))
        self.frames.append({"file": path.name, "ts": params["metadata"]["timestamp"]})
        try:
            self.cdp.send("Page.screencastFrameAck", {"sessionId": params["sessionId"]})
        except Exception:  # noqa: BLE001 — session may be closing
            pass

    def start(self):
        self.cdp.send("Page.startScreencast", {
            "format": "jpeg", "quality": self.quality,
            "maxWidth": self.size[0], "maxHeight": self.size[1], "everyNthFrame": 1,
        })

    def restart(self):
        """Call after a cross-origin navigation (renderer swap) to keep frames flowing."""
        try:
            self.cdp.send("Page.stopScreencast")
        except Exception:  # noqa: BLE001
            pass
        self._attach()
        self.start()

    def mark(self, name):
        self.markers[name] = time.time()
        print(f"[mark] {name} @ {self.markers[name]:.2f}", flush=True)

    def wait(self, seconds):
        """Wait while pumping CDP events (time.sleep would starve the frame handler)."""
        self.page.wait_for_timeout(int(seconds * 1000))

    def stop(self):
        try:
            self.cdp.send("Page.stopScreencast")
        except Exception:  # noqa: BLE001
            pass
        (self.dir / "frames.json").write_text(json.dumps(self.frames))
        (self.dir / "markers.json").write_text(json.dumps(self.markers, indent=2))
        print(f"[screencast] {len(self.frames)} frames, {len(self.markers)} markers → {self.dir}")
