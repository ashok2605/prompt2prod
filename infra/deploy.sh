#!/usr/bin/env bash
# Prompt2Prod — provision and deploy everything on a fresh Google Cloud project.
#
#   PROJECT_ID=my-project REGION=asia-south1 ./infra/deploy.sh
#
# Prerequisites: gcloud (authenticated as an owner), firebase-tools, Python 3.12 with backend/requirements.txt,
# and Firebase added to the project (console.firebase.google.com → Add project → pick the GCP project).
set -euo pipefail

PROJECT_ID="${PROJECT_ID:-project-b7607e7e-cc83-423b-8a1}"
REGION="${REGION:-asia-south1}"
PROJECT_NUMBER="$(gcloud projects describe "$PROJECT_ID" --format='value(projectNumber)')"
SA="prompt2prod-sa@${PROJECT_ID}.iam.gserviceaccount.com"
APP_SA="acme-tasks-runtime@${PROJECT_ID}.iam.gserviceaccount.com"
BUCKET="prompt2prod-${PROJECT_NUMBER}"
IMAGE="${REGION}-docker.pkg.dev/${PROJECT_ID}/prompt2prod/prompt2prod"
TAG="${TAG:-$(date +%Y%m%d-%H%M%S)}"
cd "$(dirname "$0")/.."

echo "▶ APIs"
gcloud services enable run.googleapis.com cloudbuild.googleapis.com artifactregistry.googleapis.com \
  aiplatform.googleapis.com firestore.googleapis.com firebase.googleapis.com firebasehosting.googleapis.com \
  firebaserules.googleapis.com identitytoolkit.googleapis.com storage.googleapis.com iam.googleapis.com \
  logging.googleapis.com --project "$PROJECT_ID"

echo "▶ Data plane: Firestore, bucket, Artifact Registry"
gcloud firestore databases create --location="$REGION" --project "$PROJECT_ID" 2>/dev/null || true
gcloud storage buckets create "gs://${BUCKET}" --location="$REGION" --uniform-bucket-level-access --project "$PROJECT_ID" 2>/dev/null || true
gcloud artifacts repositories create prompt2prod --repository-format=docker --location="$REGION" --project "$PROJECT_ID" 2>/dev/null || true

echo "▶ Service accounts (backend: least privileges it needs; target app: none)"
gcloud iam service-accounts create prompt2prod-sa --project "$PROJECT_ID" 2>/dev/null || true
gcloud iam service-accounts create acme-tasks-runtime --project "$PROJECT_ID" 2>/dev/null || true
for role in roles/datastore.user roles/storage.objectAdmin roles/cloudbuild.builds.editor roles/run.developer \
            roles/iam.serviceAccountUser roles/aiplatform.user roles/logging.logWriter roles/artifactregistry.writer \
            roles/serviceusage.serviceUsageConsumer; do
  gcloud projects add-iam-policy-binding "$PROJECT_ID" --member="serviceAccount:${SA}" --role="$role" --condition=None --quiet >/dev/null
done
gcloud iam service-accounts add-iam-policy-binding "$APP_SA" --member="serviceAccount:${SA}" \
  --role=roles/iam.serviceAccountUser --project "$PROJECT_ID" --quiet >/dev/null

echo "▶ Firestore security rules"
firebase deploy --only firestore:rules --project "$PROJECT_ID" --non-interactive

echo "▶ Image (dashboard + API + agent runner) via Cloud Build"
gcloud builds submit . --region="$REGION" --config=infra/image-build.yaml \
  --substitutions="_TAG=${TAG},_IMAGE=${IMAGE}" \
  --service-account="projects/${PROJECT_ID}/serviceAccounts/${SA}" --project "$PROJECT_ID"

echo "▶ Agent runner (Cloud Run Job: one isolated execution per request)"
gcloud run jobs deploy prompt2prod-runner --image="${IMAGE}:${TAG}" --region="$REGION" --service-account="$SA" \
  --command=python --args=-m,p2p.runner --cpu=2 --memory=2Gi --task-timeout=1800 --max-retries=0 \
  --project "$PROJECT_ID"

echo "▶ API + dashboard (Cloud Run service)"
gcloud run deploy prompt2prod --image="${IMAGE}:${TAG}" --region="$REGION" --service-account="$SA" \
  --allow-unauthenticated --cpu=1 --memory=1Gi --min-instances=1 --max-instances=4 --no-cpu-throttling \
  --timeout=900 --set-env-vars="EXECUTION_MODE=job,APP_VERSION=${TAG}" --project "$PROJECT_ID"

echo "▶ Demo project (baseline revision of the sample app)"
(cd backend && python -m scripts.bootstrap_project ../sample-apps/acme-tasks)

echo "▶ Firebase Hosting (prompt2prod.web.app → Cloud Run)"
firebase deploy --only hosting --project "$PROJECT_ID" --non-interactive

echo "✅ Done: https://prompt2prod-${PROJECT_NUMBER}.${REGION}.run.app"
