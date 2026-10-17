"""Google Cloud control plane: Cloud Build (images), Cloud Run (revisions/traffic) and Cloud Run Jobs."""
import time

from google.cloud import run_v2
from google.cloud.devtools import cloudbuild_v1

from . import config

REVISION = run_v2.TrafficTargetAllocationType.TRAFFIC_TARGET_ALLOCATION_TYPE_REVISION
LATEST = run_v2.TrafficTargetAllocationType.TRAFFIC_TARGET_ALLOCATION_TYPE_LATEST
DONE_STATES = {"SUCCESS", "FAILURE", "INTERNAL_ERROR", "TIMEOUT", "CANCELLED", "EXPIRED"}

_clients = {}


def _client(kind):
    if kind not in _clients:
        _clients[kind] = {
            "build": cloudbuild_v1.CloudBuildClient,
            "services": run_v2.ServicesClient,
            "jobs": run_v2.JobsClient,
        }[kind]()
    return _clients[kind]


def short_name(resource):
    return resource.rsplit("/", 1)[-1] if resource else resource


# ---------------------------------------------------------------- Cloud Build

def start_build(source_bucket, source_object, image, tag, labels=()):
    build = cloudbuild_v1.Build(
        source=cloudbuild_v1.Source(
            storage_source=cloudbuild_v1.StorageSource(bucket=source_bucket, object_=source_object)
        ),
        steps=[
            cloudbuild_v1.BuildStep(
                id="restore-cache", name="gcr.io/cloud-builders/docker", entrypoint="bash",
                args=["-c", f"docker pull {image}:latest || true"],
            ),
            cloudbuild_v1.BuildStep(
                id="docker-build", name="gcr.io/cloud-builders/docker",
                args=["build", "--build-arg", "BUILDKIT_INLINE_CACHE=1", "--cache-from", f"{image}:latest",
                      "-t", f"{image}:{tag}", "-t", f"{image}:latest", "."],
            ),
        ],
        images=[f"{image}:{tag}", f"{image}:latest"],
        service_account=f"projects/{config.PROJECT_ID}/serviceAccounts/{config.BUILD_SERVICE_ACCOUNT}",
        options=cloudbuild_v1.BuildOptions(logging=cloudbuild_v1.BuildOptions.LoggingMode.CLOUD_LOGGING_ONLY),
        timeout={"seconds": 900},
        tags=["prompt2prod", *labels],
    )
    op = _client("build").create_build(
        parent=f"projects/{config.PROJECT_ID}/locations/{config.REGION}",
        project_id=config.PROJECT_ID,
        build=build,
    )
    return op.metadata.build.id


def get_build(build_id):
    return _client("build").get_build(
        name=f"projects/{config.PROJECT_ID}/locations/{config.REGION}/builds/{build_id}",
        project_id=config.PROJECT_ID,
        id=build_id,
    )


def build_status(build):
    return cloudbuild_v1.Build.Status(build.status).name


def built_image_digest(build, image, tag):
    for img in build.results.images:
        if img.name in (f"{image}:{tag}", image) and img.digest:
            return f"{image}@{img.digest}"
    return f"{image}:{tag}"


def wait_for_build(build_id, on_progress=None, timeout=900):
    started = time.time()
    seen_steps = set()
    last_status = None
    while True:
        build = get_build(build_id)
        status = build_status(build)
        if status != last_status and on_progress:
            on_progress("status", status, build)
            last_status = status
        for idx, step in enumerate(build.steps):
            step_status = cloudbuild_v1.Build.Status(step.status).name
            key = (idx, step_status)
            if step_status in ("WORKING", "SUCCESS", "FAILURE") and key not in seen_steps and on_progress:
                seen_steps.add(key)
                on_progress("step", f"{step.id or idx}:{step_status}", build)
        if status in DONE_STATES:
            return build
        if time.time() - started > timeout:
            raise TimeoutError(f"build {build_id} did not finish in {timeout}s")
        time.sleep(3)


# ---------------------------------------------------------------- Cloud Run services

def service_path(service):
    return f"projects/{config.PROJECT_ID}/locations/{config.REGION}/services/{service}"


def get_service(service):
    return _client("services").get_service(name=service_path(service))


def serving_revision(svc):
    """Revision that currently receives the most traffic."""
    best = max(svc.traffic_statuses, key=lambda t: t.percent, default=None)
    if best is None or best.type_ == LATEST or not best.revision:
        return short_name(svc.latest_ready_revision)
    return best.revision


def _compose_traffic(svc, serving, new_tag=None, keep_tags=None):
    """100% to `serving`; keep tagged preview URLs alive (0%), newest tags last."""
    keep_tags = keep_tags or config.PREVIEW_TAGS_TO_KEEP
    tagged = []
    for t in svc.traffic:
        if t.tag:
            rev = t.revision or short_name(svc.latest_ready_revision)
            tagged.append((rev, t.tag))
    if new_tag:
        tagged.append(new_tag)
    pinned = [x for x in tagged if x[1] == "baseline"]
    previews = [x for x in tagged if x[1] != "baseline"][-keep_tags:]
    entries, serving_done = [], False
    for rev, tag in pinned + previews:
        pct = 0
        if rev == serving and not serving_done:
            pct, serving_done = 100, True
        entries.append(run_v2.TrafficTarget(type_=REVISION, revision=rev, tag=tag, percent=pct))
    if not serving_done:
        entries.insert(0, run_v2.TrafficTarget(type_=REVISION, revision=serving, percent=100))
    return entries


def deploy_revision(service, image, revision, tag, serve=False, service_account=None, env=None):
    """Create a new revision with its own tagged URL. Production traffic is untouched unless serve=True."""
    client = _client("services")
    svc = get_service(service)
    current = serving_revision(svc)
    container = svc.template.containers[0]
    container.image = image
    if env:
        existing = {e.name: e for e in container.env}
        for key, value in env.items():
            if key in existing:
                existing[key].value = value
            else:
                container.env.append(run_v2.EnvVar(name=key, value=value))
    svc.template.revision = revision
    if service_account:
        svc.template.service_account = service_account
    svc.traffic = _compose_traffic(svc, revision if serve else current, new_tag=(revision, tag))
    result = client.update_service(service=svc).result(timeout=600)
    url = next((t.uri for t in result.traffic_statuses if t.tag == tag), None)
    return {"url": url, "revision": revision, "tag": tag, "previousRevision": current, "serviceUrl": result.uri}


def set_serving_revision(service, revision):
    """Route 100% of production traffic to `revision` (promote / rollback / reset)."""
    client = _client("services")
    svc = get_service(service)
    previous = serving_revision(svc)
    svc.traffic = _compose_traffic(svc, revision)
    result = client.update_service(service=svc).result(timeout=600)
    return {"url": result.uri, "revision": revision, "previousRevision": previous}


# ---------------------------------------------------------------- Cloud Run Jobs

def run_runner_job(task_id):
    """Start an isolated Cloud Run Job execution for one task (returns immediately)."""
    request = run_v2.RunJobRequest(
        name=f"projects/{config.PROJECT_ID}/locations/{config.REGION}/jobs/{config.RUNNER_JOB}",
        overrides=run_v2.RunJobRequest.Overrides(
            container_overrides=[
                run_v2.RunJobRequest.Overrides.ContainerOverride(
                    env=[run_v2.EnvVar(name="TASK_ID", value=task_id)]
                )
            ]
        ),
    )
    op = _client("jobs").run_job(request=request)
    try:
        return short_name(op.metadata.name)
    except Exception:
        return None
