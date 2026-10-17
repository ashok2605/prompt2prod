"""Assemble the demo video: screencast frames + cards + Chirp 3 HD narration + burned-in captions.

    python video/assemble.py            # → video/build/prompt2prod-demo.mp4
"""
import json
import pathlib
import re
import subprocess

HERE = pathlib.Path(__file__).parent
BUILD = HERE / "build"
RAW = BUILD / "raw"
AUDIO = BUILD / "audio"
SCENES_DIR = BUILD / "scenes"
FFMPEG = "/opt/homebrew/opt/ffmpeg-full/bin/ffmpeg"
FPS = 30
W, H = 1920, 1080
LEAD_IN = 0.45  # seconds of silence before narration starts in each scene
TAIL = 0.55     # breathing room after narration


def run(cmd):
    proc = subprocess.run(cmd, capture_output=True, text=True)
    if proc.returncode != 0:
        raise SystemExit(f"ffmpeg failed: {' '.join(cmd[:12])}…\n{proc.stderr[-2500:]}")


def build_raw_video():
    """Variable-rate screencast frames → constant 30 fps master (time 0 = first frame)."""
    frames = json.loads((RAW / "frames.json").read_text())
    lines = []
    for i, frame in enumerate(frames):
        nxt = frames[i + 1]["ts"] if i + 1 < len(frames) else frame["ts"] + 1 / FPS
        lines.append(f"file '{frame['file']}'\nduration {max(nxt - frame['ts'], 0.001):.4f}")
    lines.append(f"file '{frames[-1]['file']}'")
    (RAW / "concat.txt").write_text("\n".join(lines) + "\n")
    master = BUILD / "master.mp4"
    run([FFMPEG, "-y", "-f", "concat", "-safe", "0", "-i", str(RAW / "concat.txt"),
         "-vf", f"fps={FPS},scale={W}:{H}:flags=lanczos,format=yuv420p",
         "-c:v", "libx264", "-preset", "medium", "-crf", "16", str(master)])
    return master, frames[0]["ts"]


def audio_filter(narration, total):
    if narration:
        return (["-i", str(AUDIO / f"{narration}.wav")],
                f"[1:a]aformat=sample_rates=48000:channel_layouts=stereo,adelay={int(LEAD_IN * 1000)}:all=1,"
                f"apad,atrim=0:{total:.3f}[a]")
    return (["-f", "lavfi", "-i", "anullsrc=r=48000:cl=stereo"], f"[1:a]atrim=0:{total:.3f}[a]")


def render_card(scene, durations):
    narr = scene.get("narration")
    total = max((durations.get(narr, 0) + LEAD_IN + TAIL) if narr else 0, scene.get("min", 3))
    out = SCENES_DIR / f"{scene['id']}.mp4"
    extra_in, afilter = audio_filter(narr, total)
    zoom = (f"zoompan=z='min(1+0.00025*on,1.06)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d={int(total * FPS) + 1}"
            f":s={W}x{H}:fps={FPS}") if scene.get("zoom", True) else f"fps={FPS}"
    vf = f"[0:v]scale={W * 2}:{H * 2},{zoom},trim=0:{total:.3f},format=yuv420p[v]" if scene.get("zoom", True) \
        else f"[0:v]scale={W}:{H},fps={FPS},trim=0:{total:.3f},format=yuv420p[v]"
    run([FFMPEG, "-y", "-loop", "1", "-framerate", str(FPS), "-i", str(HERE / scene["image"]), *extra_in,
         "-filter_complex", f"{vf};{afilter}", "-map", "[v]", "-map", "[a]", "-t", f"{total:.3f}",
         "-c:v", "libx264", "-preset", "medium", "-crf", "16", "-r", str(FPS), "-c:a", "aac", "-b:a", "192k", str(out)])
    return out, total


def render_clip(scene, durations, master, t0, markers):
    start = markers[scene["from"]] - t0 + scene.get("from_offset", 0)
    end = markers[scene["to"]] - t0 + scene.get("to_offset", 0)
    raw_len = max(end - start, 0.5)
    narr = scene.get("narration")
    target = max((durations.get(narr, 0) + LEAD_IN + TAIL) if narr else raw_len, scene.get("min", 0))
    speed = raw_len / target
    max_speed = scene.get("max_speed", 14)
    if speed > max_speed:  # never go beyond max_speed; the scene simply runs longer
        speed = max_speed
        target = raw_len / speed
    out = SCENES_DIR / f"{scene['id']}.mp4"
    extra_in, afilter = audio_filter(narr, target)
    if speed >= 1:
        vchain = f"setpts=(PTS-STARTPTS)/{speed:.5f}"
    else:  # raw footage shorter than narration: play at 1x, then hold the last frame
        vchain = f"setpts=PTS-STARTPTS,tpad=stop_mode=clone:stop_duration={target - raw_len + 0.1:.3f}"
    vf = f"[0:v]{vchain},fps={FPS},trim=0:{target:.3f},format=yuv420p[v]"
    run([FFMPEG, "-y", "-ss", f"{start:.3f}", "-t", f"{raw_len:.3f}", "-i", str(master), *extra_in,
         "-filter_complex", f"{vf};{afilter}", "-map", "[v]", "-map", "[a]", "-t", f"{target:.3f}",
         "-c:v", "libx264", "-preset", "medium", "-crf", "16", "-r", str(FPS), "-c:a", "aac", "-b:a", "192k", str(out)])
    print(f"  clip {scene['id']:10} raw {raw_len:6.1f}s → {target:5.1f}s (×{speed:.2f})")
    return out, target


def ass_time(t):
    h, rem = divmod(t, 3600)
    m, s = divmod(rem, 60)
    return f"{int(h)}:{int(m):02d}:{s:05.2f}"


def chunk_text(text, max_words=11):
    parts = re.split(r"(?<=[.!?;:])\s+|,\s+(?=\S)", text)
    chunks = []
    for part in parts:
        words = part.split()
        while words:
            chunks.append(" ".join(words[:max_words]))
            words = words[max_words:]
    return [c for c in chunks if c.strip()]


def write_captions(timeline, narration_text, durations):
    header = (
        "[Script Info]\nScriptType: v4.00+\nPlayResX: 1920\nPlayResY: 1080\nWrapStyle: 0\n\n"
        "[V4+ Styles]\nFormat: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, "
        "Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, "
        "MarginL, MarginR, MarginV, Encoding\n"
        "Style: Cap,Helvetica Neue,40,&H00FFFFFF,&H00FFFFFF,&H00101010,&H99000000,0,0,0,0,100,100,0,0,3,14,0,2,200,200,46,1\n\n"
        "[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n"
    )
    events = []
    for scene_start, scene in timeline:
        narr = scene.get("narration")
        if not narr or scene.get("no_captions"):
            continue
        text = narration_text[narr]
        chunks = chunk_text(text)
        total_chars = sum(len(c) for c in chunks)
        t = scene_start + LEAD_IN
        for c in chunks:
            dur = durations[narr] * len(c) / total_chars
            events.append(f"Dialogue: 0,{ass_time(t)},{ass_time(t + dur - 0.05)},Cap,,0,0,0,,{c}")
            t += dur
    path = BUILD / "captions.ass"
    path.write_text(header + "\n".join(events) + "\n")
    return path


def main():
    SCENES_DIR.mkdir(parents=True, exist_ok=True)
    scenes = json.loads((HERE / "scenes.json").read_text())
    durations = json.loads((AUDIO / "durations.json").read_text())
    narration_text = {s["id"]: s["text"] for s in json.loads((HERE / "narration.json").read_text())["segments"]}
    master, t0 = build_raw_video()
    markers = json.loads((RAW / "markers.json").read_text())
    parts, timeline, clock = [], [], 0.0
    for scene in scenes:
        if scene["type"] == "card":
            out, dur = render_card(scene, durations)
        else:
            out, dur = render_clip(scene, durations, master, t0, markers)
        parts.append(out)
        timeline.append((clock, scene))
        clock += dur
    (BUILD / "parts.txt").write_text("".join(f"file '{p}'\n" for p in parts))
    joined = BUILD / "joined.mp4"
    run([FFMPEG, "-y", "-f", "concat", "-safe", "0", "-i", str(BUILD / "parts.txt"), "-c", "copy", str(joined)])
    captions = write_captions(timeline, narration_text, durations)
    final = BUILD / "prompt2prod-demo.mp4"
    run([FFMPEG, "-y", "-i", str(joined),
         "-vf", f"ass={captions},fade=t=in:st=0:d=0.6,fade=t=out:st={clock - 0.8:.2f}:d=0.8",
         "-af", f"afade=t=in:st=0:d=0.4,afade=t=out:st={clock - 0.8:.2f}:d=0.8,loudnorm=I=-16:TP=-1.5:LRA=11",
         "-c:v", "libx264", "-preset", "slow", "-crf", "18", "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "192k",
         "-movflags", "+faststart", str(final)])
    print(f"final video: {final} ({clock:.1f}s)")


if __name__ == "__main__":
    main()
