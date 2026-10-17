"""DORA + productivity metrics computed from task history (same formulas as the dashboard)."""
import statistics
from datetime import timedelta

from .store import utcnow


def _seconds(a, b):
    return (a - b).total_seconds()


def compute(tasks, projects, days=14):
    now = utcnow()
    since = now - timedelta(days=days)
    recent = [t for t in tasks if t.get("createdAt") and t["createdAt"] >= since]
    released = [t for t in recent if (t.get("release") or {}).get("promotedAt")]

    per_day = {(now - timedelta(days=i)).date().isoformat(): 0 for i in range(days - 1, -1, -1)}
    for t in released:
        day = t["release"]["promotedAt"].date().isoformat()
        if day in per_day:
            per_day[day] += 1

    lead = sorted(_seconds(t["release"]["promotedAt"], t["createdAt"]) for t in released)
    deployed = [t for t in recent if t.get("status") == "deployed"]
    rolled = [t for t in recent if t.get("status") == "rolled_back"]
    finished = [t for t in recent if t.get("status") in
                ("deployed", "awaiting_approval", "rolled_back", "failed", "rejected")]
    good = [t for t in finished if t.get("status") in ("deployed", "awaiting_approval", "rolled_back")]

    mttr = [r.get("mttrSec") for p in projects for r in (p.get("releases") or [])
            if r.get("kind") == "rollback" and r.get("mttrSec") is not None]
    costs = [(t.get("metrics") or {}).get("costUsd", 0) for t in recent if (t.get("metrics") or {}).get("costUsd")]
    tokens = sum((t.get("metrics") or {}).get("tokensIn", 0) + (t.get("metrics") or {}).get("tokensOut", 0)
                 for t in recent)

    return {
        "windowDays": days,
        "totals": {
            "tasks": len(recent), "deployed": len(deployed), "rolledBack": len(rolled),
            "failed": sum(t.get("status") == "failed" for t in recent),
            "awaiting": sum(t.get("status") == "awaiting_approval" for t in recent),
        },
        "deploymentFrequency": {
            "perDay": round(len(released) / days, 2),
            "series": [{"date": d, "count": c} for d, c in per_day.items()],
        },
        "leadTime": {
            "medianSec": round(statistics.median(lead)) if lead else None,
            "p90Sec": round(lead[min(len(lead) - 1, int(len(lead) * 0.9))]) if lead else None,
        },
        "changeFailureRate": round(len(rolled) / max(len(deployed) + len(rolled), 1), 3),
        "mttrSec": round(statistics.mean(mttr)) if mttr else None,
        "successRate": round(len(good) / len(finished), 3) if finished else None,
        "testsWritten": sum((t.get("tests") or {}).get("newTests", 0) for t in recent),
        "selfHealed": sum(bool((t.get("tests") or {}).get("selfHealed")) for t in recent),
        "hoursSaved": round(sum((t.get("plan") or {}).get("estimatedHours", 0) for t in deployed), 1),
        "cost": {"totalUsd": round(sum(costs), 3), "avgUsd": round(sum(costs) / len(costs), 3) if costs else 0,
                 "tokens": tokens},
    }
