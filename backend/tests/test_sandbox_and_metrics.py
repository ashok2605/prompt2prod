from datetime import timedelta

from p2p import metrics, sandbox
from p2p.store import utcnow


def test_summarize_green_and_red():
    assert sandbox.summarize({"ok": True, "passed": 12, "total": 12, "failed": 0, "failing": []}) == "12/12 passed"
    red = sandbox.summarize({"ok": False, "passed": 10, "total": 12, "failed": 2,
                             "failing": ["tests/test_api.py::test_a", "tests/test_api.py::test_b"]})
    assert red.startswith("2 failed of 12") and "test_a" in red


def test_run_tests_on_a_tiny_project(tmp_path):
    (tmp_path / "test_ok.py").write_text("def test_ok():\n    assert 1 + 1 == 2\n")
    result = sandbox.run_tests(str(tmp_path))
    assert result["ok"] and result["passed"] == 1 and result["total"] == 1


def test_dora_metrics():
    now = utcnow()
    tasks = [
        {"status": "deployed", "createdAt": now - timedelta(minutes=10),
         "release": {"promotedAt": now - timedelta(minutes=8)}, "plan": {"estimatedHours": 2},
         "tests": {"newTests": 3, "selfHealed": True}, "metrics": {"costUsd": 0.1, "tokensIn": 100, "tokensOut": 10}},
        {"status": "rolled_back", "createdAt": now - timedelta(minutes=30),
         "release": {"promotedAt": now - timedelta(minutes=27)}, "tests": {"newTests": 1}, "metrics": {}},
        {"status": "failed", "createdAt": now - timedelta(minutes=5), "metrics": {}},
    ]
    projects = [{"releases": [{"kind": "rollback", "mttrSec": 40}]}]
    m = metrics.compute(tasks, projects)
    assert m["totals"]["deployed"] == 1 and m["totals"]["rolledBack"] == 1
    assert m["changeFailureRate"] == 0.5
    assert m["mttrSec"] == 40
    assert m["testsWritten"] == 4 and m["selfHealed"] == 1 and m["hoursSaved"] == 2
    assert m["leadTime"]["medianSec"] == 150
    assert abs(m["successRate"] - 2 / 3) < 1e-3
