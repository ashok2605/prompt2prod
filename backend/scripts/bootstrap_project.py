"""Register a sample app with Prompt2Prod: git baseline → bundles in GCS → baseline Cloud Run revision → Firestore.

Usage (from backend/):  python -m scripts.bootstrap_project ../sample-apps/acme-tasks
"""
import os
import shutil
import subprocess
import sys
import tempfile

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from p2p import cloud, config, gitrepo, store  # noqa: E402

PROJECT = {
    "id": "acme-tasks",
    "name": "Acme Tasks",
    "description": "Team task tracker — Flask web UI + JSON API, deployed on Cloud Run",
    "stack": "Python 3.12 · Flask · pytest",
    "service": "acme-tasks",
    "region": config.REGION,
    "runtimeServiceAccount": f"acme-tasks-runtime@{config.PROJECT_ID}.iam.gserviceaccount.com",
}


def main(src):
    pid = PROJECT["id"]
    with tempfile.TemporaryDirectory() as tmp:
        repo = os.path.join(tmp, "repo")
        shutil.copytree(src, repo, ignore=shutil.ignore_patterns("__pycache__", ".pytest_cache", ".venv"))
        gitrepo.git(["init", "--quiet", "-b", "main"], cwd=repo)
        gitrepo.git(["add", "-A"], cwd=repo)
        gitrepo.git(["commit", "--quiet", "-m", "chore: Acme Tasks baseline"], cwd=repo)
        sha = gitrepo.git(["rev-parse", "HEAD"], cwd=repo).strip()
        bundle = os.path.join(tmp, "main.bundle")
        gitrepo.git(["bundle", "create", bundle, "main"], cwd=repo)
        gitrepo._upload(bundle, gitrepo.baseline_bundle(pid))
        gitrepo._upload(bundle, gitrepo.main_bundle(pid))
        print("baseline commit", sha)

        tarball = os.path.join(tmp, "src.tgz")
        gitrepo.git(["archive", "--format=tar.gz", "-o", tarball, "HEAD"], cwd=repo)
        obj = f"sources/{pid}-baseline.tgz"
        gitrepo._upload(tarball, obj)

    image = f"{config.IMAGE_REPO}/{PROJECT['service']}"
    build_id = cloud.start_build(config.BUCKET, obj, image, "baseline", ("baseline",))
    print("build", build_id)
    build = cloud.wait_for_build(build_id, lambda kind, value, _b: print(" ", kind, value))
    if cloud.build_status(build) != "SUCCESS":
        raise SystemExit(f"build failed: {build.status_detail}")
    image_ref = cloud.built_image_digest(build, image, "baseline")

    revision = f"{PROJECT['service']}-baseline"
    try:
        svc = cloud.get_service(PROJECT["service"])
        existing = {cloud.short_name(t.revision) for t in svc.traffic_statuses}
    except Exception:  # noqa: BLE001
        existing = set()
    if revision in existing:
        res = cloud.set_serving_revision(PROJECT["service"], revision)
    else:
        res = cloud.deploy_revision(PROJECT["service"], image_ref, revision, "baseline", serve=True,
                                    service_account=PROJECT["runtimeServiceAccount"])
    svc = cloud.get_service(PROJECT["service"])
    print("deployed", res)

    store.update_project(pid, {
        **PROJECT,
        "prodUrl": svc.uri,
        "prodRevision": revision,
        "prodCommit": sha[:7],
        "prodCommitFull": sha,
        "prodTaskId": None,
        "baselineRevision": revision,
        "baselineCommit": sha,
        "baselineImage": image_ref,
        "releases": [{
            "kind": "reset", "taskId": None, "title": "Baseline release", "revision": revision,
            "commit": sha[:7], "commitFull": sha, "url": svc.uri, "at": store.utcnow(), "by": "bootstrap",
        }],
    })
    print("project registered:", svc.uri)


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else "../sample-apps/acme-tasks")
