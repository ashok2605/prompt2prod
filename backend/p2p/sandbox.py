"""Runs a project's test suite inside the task sandbox (the Cloud Run Job container)."""
import hashlib
import os
import subprocess
import sys
import time
import xml.etree.ElementTree as ET

from . import config

_SAFE_ENV_DROP = ("PYTHONPATH", "TASK_ID", "INTAKE_KEY")


def _tail(text, limit):
    return text if len(text) <= limit else "…(truncated)…\n" + text[-limit:]


def _ensure_dependencies(repo):
    req = os.path.join(repo, "requirements.txt")
    if not os.path.exists(req):
        return None
    digest = hashlib.sha256(open(req, "rb").read()).hexdigest()[:16]
    marker = os.path.join(config.WORK_ROOT, f".deps-{digest}")
    if os.path.exists(marker):
        return None
    proc = subprocess.run(
        [sys.executable, "-m", "pip", "install", "--quiet", "--disable-pip-version-check", "-r", req],
        cwd=repo, capture_output=True, text=True, timeout=300,
    )
    if proc.returncode == 0:
        os.makedirs(config.WORK_ROOT, exist_ok=True)
        open(marker, "w").close()
        return None
    return _tail(proc.stdout + proc.stderr, 3000)


def run_tests(repo, timeout=180):
    """Run pytest and return a structured result."""
    started = time.time()
    dep_error = _ensure_dependencies(repo)
    report = os.path.join(os.path.dirname(repo), f"junit-{int(started * 1000)}.xml")
    env = {k: v for k, v in os.environ.items() if k not in _SAFE_ENV_DROP}
    env.update(PYTHONDONTWRITEBYTECODE="1", PYTHONUNBUFFERED="1")
    cmd = [sys.executable, "-m", "pytest", "-q", "-rfE", "--tb=short", "-p", "no:cacheprovider",
           f"--junitxml={report}"]
    try:
        proc = subprocess.run(cmd, cwd=repo, capture_output=True, text=True, timeout=timeout, env=env)
        output = proc.stdout + proc.stderr
        exit_code = proc.returncode
    except subprocess.TimeoutExpired:
        return {"ok": False, "passed": 0, "failed": 1, "total": 1, "failing": ["<timeout>"],
                "output": f"pytest timed out after {timeout}s", "durationSec": round(time.time() - started, 2)}

    total = failures = errors = skipped = 0
    failing = []
    try:
        root = ET.parse(report).getroot()
        suites = [root] if root.tag == "testsuite" else root.findall("testsuite")
        for suite in suites:
            total += int(suite.get("tests", 0))
            failures += int(suite.get("failures", 0))
            errors += int(suite.get("errors", 0))
            skipped += int(suite.get("skipped", 0))
            for case in suite.iter("testcase"):
                if case.find("failure") is not None or case.find("error") is not None:
                    failing.append(f"{case.get('classname', '')}::{case.get('name', '')}".strip(":"))
        os.remove(report)
    except (ET.ParseError, FileNotFoundError):
        if exit_code != 0:
            errors = max(errors, 1)

    failed = failures + errors
    passed = max(total - failed - skipped, 0)
    if dep_error:
        output = f"[dependency install failed]\n{dep_error}\n\n{output}"
    return {
        "ok": exit_code == 0 and total > 0 and failed == 0,
        "passed": passed,
        "failed": failed,
        "total": total,
        "failing": failing[:20],
        "output": _tail(output, 7000),
        "durationSec": round(time.time() - started, 2),
    }


def summarize(result):
    if result["ok"]:
        return f"{result['passed']}/{result['total']} passed"
    names = ", ".join(n.split("::")[-1] for n in result["failing"][:4])
    more = "" if len(result["failing"]) <= 4 else f" +{len(result['failing']) - 4} more"
    return f"{result['failed']} failed of {result['total']}" + (f": {names}{more}" if names else "")
