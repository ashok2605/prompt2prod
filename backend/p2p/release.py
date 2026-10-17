"""Release management: promote a verified preview to production, roll back, reset the demo."""
from . import cloud, gitrepo, store

MAX_RELEASES = 30


class ReleaseError(RuntimeError):
    pass


def _append_release(project, entry):
    releases = list(project.get("releases") or [])
    releases.append(entry)
    return releases[-MAX_RELEASES:]


def promote(task, by, log=None):
    task_id = task["id"]
    project = store.get_project(task["projectId"])
    preview = task.get("preview") or {}
    commit = task.get("commit") or {}
    if not preview.get("revision") or not commit.get("sha"):
        raise ReleaseError("This task has no verified preview to release yet.")
    if project.get("prodCommitFull") and commit.get("baseSha") != project["prodCommitFull"]:
        raise ReleaseError(
            "Production changed after this task started; retry the task so the crew rebases it on the latest code."
        )
    if log:
        log.emit("release", "Release Manager", "tool", "git: fast-forward main → " + commit["sha"][:7])
    sha = gitrepo.promote_task_branch(task["projectId"], task_id)
    if log:
        log.emit("release", "Release Manager", "tool",
                 f"Cloud Run: route 100% traffic → {preview['revision']}")
    traffic = cloud.set_serving_revision(project["service"], preview["revision"])
    now = store.utcnow()
    release = {
        "url": project.get("prodUrl") or traffic["url"],
        "revision": preview["revision"],
        "promotedAt": now,
        "promotedBy": by,
        "previousRevision": traffic["previousRevision"],
        "previousCommit": project.get("prodCommitFull"),
        "previousTaskId": project.get("prodTaskId"),
    }
    store.update_project(project["id"], {
        "prodRevision": preview["revision"],
        "prodCommit": sha[:7],
        "prodCommitFull": sha,
        "prodTaskId": task_id,
        "releases": _append_release(project, {
            "kind": "release", "taskId": task_id, "title": task.get("title") or task.get("prompt", "")[:60],
            "revision": preview["revision"], "commit": sha[:7], "commitFull": sha,
            "url": release["url"], "at": now, "by": by,
        }),
    })
    finished = task.get("finishedAt") or now
    created = task.get("createdAt") or now
    store.update_task(task_id, {
        "status": "deployed",
        "stage": "done",
        "release": release,
        "stages.release": {"status": "done", "startedAt": task.get("stages", {}).get("release", {}).get("startedAt", now),
                           "endedAt": now, "summary": f"live · by {by}"},
        "metrics.leadTimeSec": round((now - created).total_seconds()),
        "finishedAt": finished,
    })
    if log:
        log.emit("release", "Release Manager", "success", f"Released to production by {by} 🚀", release["url"])
    return release


def rollback(task, by):
    project = store.get_project(task["projectId"])
    if project.get("prodTaskId") != task["id"]:
        raise ReleaseError("Only the change that is currently in production can be rolled back.")
    release = task.get("release") or {}
    prev_rev = release.get("previousRevision") or project.get("baselineRevision")
    prev_commit = release.get("previousCommit") or project.get("baselineCommit")
    prev_task = release.get("previousTaskId")
    log = store.EventLog.resume(task["id"])
    log.emit("release", "Release Manager", "warn", f"Rollback requested by {by}")
    cloud.set_serving_revision(project["service"], prev_rev)
    log.emit("release", "Release Manager", "tool", f"Cloud Run: route 100% traffic → {prev_rev}")
    if prev_commit:
        gitrepo.reset_main(project["id"], prev_commit)
        log.emit("release", "Release Manager", "tool", f"git: reset main → {prev_commit[:7]}")
    now = store.utcnow()
    store.update_project(project["id"], {
        "prodRevision": prev_rev,
        "prodCommit": (prev_commit or "")[:7],
        "prodCommitFull": prev_commit,
        "prodTaskId": prev_task,
        "releases": _append_release(project, {
            "kind": "rollback", "taskId": task["id"], "title": f"Rolled back: {task.get('title') or 'change'}",
            "revision": prev_rev, "commit": (prev_commit or "")[:7], "commitFull": prev_commit,
            "url": project.get("prodUrl"), "at": now, "by": by,
            "mttrSec": round((now - release["promotedAt"]).total_seconds()) if release.get("promotedAt") else None,
        }),
    })
    store.update_task(task["id"], {"status": "rolled_back", "rolledBackAt": now, "rolledBackBy": by})
    log.emit("release", "Release Manager", "success", f"Production restored to {prev_rev}")
    return {"revision": prev_rev, "commit": prev_commit}


def reset_project(project_id, by):
    project = store.get_project(project_id)
    baseline_rev = project.get("baselineRevision")
    if not baseline_rev:
        raise ReleaseError("Project has no baseline revision.")
    cloud.set_serving_revision(project["service"], baseline_rev)
    gitrepo.reset_to_baseline(project_id)
    now = store.utcnow()
    store.update_project(project_id, {
        "prodRevision": baseline_rev,
        "prodCommit": (project.get("baselineCommit") or "")[:7],
        "prodCommitFull": project.get("baselineCommit"),
        "prodTaskId": None,
        "releases": _append_release(project, {
            "kind": "reset", "taskId": None, "title": "Reset demo to baseline", "revision": baseline_rev,
            "commit": (project.get("baselineCommit") or "")[:7], "commitFull": project.get("baselineCommit"),
            "url": project.get("prodUrl"), "at": now, "by": by,
        }),
    })
    return {"revision": baseline_rev}
