"""Synthesize narration segments with Google Cloud Text-to-Speech (Chirp 3 HD) → WAV + durations.

    python video/tts.py video/narration.json   # writes video/build/audio/<id>.wav and durations.json
"""
import base64
import json
import pathlib
import subprocess
import sys
import wave

import google.auth
import google.auth.transport.requests
import httpx

PROJECT = "project-b7607e7e-cc83-423b-8a1"
VOICE = "en-US-Chirp3-HD-Charon"


def token():
    creds, _ = google.auth.default(scopes=["https://www.googleapis.com/auth/cloud-platform"])
    creds.refresh(google.auth.transport.requests.Request())
    return creds.token


def synth(text, out, voice=VOICE, rate=1.06):
    body = {
        "input": {"text": text},
        "voice": {"languageCode": "en-US", "name": voice},
        "audioConfig": {"audioEncoding": "LINEAR16", "sampleRateHertz": 24000, "speakingRate": rate},
    }
    res = httpx.post("https://texttospeech.googleapis.com/v1/text:synthesize", json=body, timeout=60,
                     headers={"Authorization": f"Bearer {token()}", "x-goog-user-project": PROJECT})
    res.raise_for_status()
    out.write_bytes(base64.b64decode(res.json()["audioContent"]))
    with wave.open(str(out)) as w:
        return w.getnframes() / w.getframerate()


def main(path):
    spec = json.loads(pathlib.Path(path).read_text())
    outdir = pathlib.Path(__file__).parent / "build" / "audio"
    outdir.mkdir(parents=True, exist_ok=True)
    durations = {}
    for seg in spec["segments"]:
        dur = synth(seg["text"], outdir / f"{seg['id']}.wav", spec.get("voice", VOICE), spec.get("rate", 1.06))
        durations[seg["id"]] = round(dur, 2)
        print(f"{seg['id']:12} {dur:6.2f}s  {seg['text'][:70]}")
    (outdir / "durations.json").write_text(json.dumps(durations, indent=2))
    print("total", round(sum(durations.values()), 1), "s")


if __name__ == "__main__":
    main(sys.argv[1])
