"""Runtime configuration (all overridable through environment variables)."""
import json
import os

PROJECT_ID = os.environ.get("GOOGLE_CLOUD_PROJECT", "project-b7607e7e-cc83-423b-8a1")
PROJECT_NUMBER = os.environ.get("PROJECT_NUMBER", "82783179546")
REGION = os.environ.get("REGION", "asia-south1")
BUCKET = os.environ.get("BUCKET", f"prompt2prod-{PROJECT_NUMBER}")
IMAGE_REPO = os.environ.get("IMAGE_REPO", f"{REGION}-docker.pkg.dev/{PROJECT_ID}/prompt2prod")
BUILD_SERVICE_ACCOUNT = os.environ.get(
    "BUILD_SERVICE_ACCOUNT", f"prompt2prod-sa@{PROJECT_ID}.iam.gserviceaccount.com"
)
RUNNER_JOB = os.environ.get("RUNNER_JOB", "prompt2prod-runner")
# "job": every task runs in its own Cloud Run Job execution (isolated sandbox).
# "inline": run inside the API process (local development / fallback).
EXECUTION_MODE = os.environ.get("EXECUTION_MODE", "job")
WORK_ROOT = os.environ.get("WORK_ROOT", "/tmp/p2p")

# Gemini on Vertex AI (ADK + google-genai read these).
os.environ.setdefault("GOOGLE_GENAI_USE_VERTEXAI", "TRUE")
os.environ.setdefault("GOOGLE_CLOUD_PROJECT", PROJECT_ID)
os.environ.setdefault("GOOGLE_CLOUD_LOCATION", os.environ.get("GEMINI_LOCATION", "global"))

MODELS = {
    "planner": os.environ.get("PLANNER_MODEL", "gemini-3.1-pro-preview"),
    "test_author": os.environ.get("TEST_AUTHOR_MODEL", "gemini-3.6-flash"),
    "coder": os.environ.get("CODER_MODEL", "gemini-3.6-flash"),
    "reviewer": os.environ.get("REVIEWER_MODEL", "gemini-3.1-pro-preview"),
    "verifier": os.environ.get("VERIFIER_MODEL", "gemini-3.6-flash"),
}
# Gemini 3 thinking level per role (MINIMAL / LOW / MEDIUM / HIGH).
THINKING = {
    "planner": os.environ.get("PLANNER_THINKING", "LOW"),
    "test_author": os.environ.get("TEST_AUTHOR_THINKING", "LOW"),
    "coder": os.environ.get("CODER_THINKING", "LOW"),
    "reviewer": os.environ.get("REVIEWER_THINKING", "LOW"),
    "verifier": os.environ.get("VERIFIER_THINKING", "LOW"),
}
FALLBACK_MODELS = [
    m.strip()
    for m in os.environ.get("FALLBACK_MODELS", "gemini-3.6-flash,gemini-3.5-flash,gemini-2.5-flash").split(",")
    if m.strip()
]

# Latency guard: if an agent run exceeds its budget (preview models can spike), retry on the next model.
AGENT_TIMEOUTS = {"planner": 45, "reviewer": 40, "verifier": 45, "test_author": 120, "coder": 240}

# Approximate list prices (USD per 1M tokens: input, output) used for the cost meter.
MODEL_PRICES = {
    "gemini-3.1-pro-preview": (2.00, 12.00),
    "gemini-3.6-flash": (0.50, 3.00),
    "gemini-3.5-flash": (0.50, 3.00),
    "gemini-2.5-pro": (1.25, 10.00),
    "gemini-2.5-flash": (0.30, 2.50),
}

MAX_TEST_ATTEMPTS = int(os.environ.get("MAX_TEST_ATTEMPTS", "3"))
LIMIT_PER_USER_PER_HOUR = int(os.environ.get("LIMIT_PER_USER_PER_HOUR", "6"))
LIMIT_PER_DAY = int(os.environ.get("LIMIT_PER_DAY", "40"))
PREVIEW_TAGS_TO_KEEP = int(os.environ.get("PREVIEW_TAGS_TO_KEEP", "12"))

# ---------------------------------------------------------------- secrets (Google Cloud Secret Manager)
# Cloud Run injects them as environment variables (`--set-secrets`). Locally they are read from Secret
# Manager with your Application Default Credentials. Nothing secret is ever committed to the repository.
FIREBASE_CONFIG_SECRET = os.environ.get("FIREBASE_CONFIG_SECRET", "prompt2prod-firebase-web-config")
INTAKE_KEY_SECRET = os.environ.get("INTAKE_KEY_SECRET", "prompt2prod-intake-key")
_secret_cache = {}


def secret(name, env_var):
    if os.environ.get(env_var):
        return os.environ[env_var]
    if name not in _secret_cache:
        try:
            from google.cloud import secretmanager  # noqa: WPS433 — only needed outside Cloud Run

            client = secretmanager.SecretManagerServiceClient()
            version = f"projects/{PROJECT_ID}/secrets/{name}/versions/latest"
            _secret_cache[name] = client.access_secret_version(name=version).payload.data.decode()
        except Exception as exc:  # noqa: BLE001 — a missing secret disables the feature, never crashes
            print(f"[config] secret {name} unavailable: {exc}", flush=True)
            _secret_cache[name] = None
    return _secret_cache[name]


def firebase_web_config():
    """Firebase web SDK config (restricted browser API key) for the dashboard."""
    raw = secret(FIREBASE_CONFIG_SECRET, "FIREBASE_WEB_CONFIG")
    return json.loads(raw) if raw else None


def intake_key():
    """Shared key that authorises POST /api/webhooks/intake (CLI, scripts, other tools)."""
    return secret(INTAKE_KEY_SECRET, "INTAKE_KEY")

VERSION = os.environ.get("APP_VERSION", "1.0.0")

STAGES = ["sandbox", "plan", "tests", "code", "test", "review", "build", "preview", "verify", "release"]
