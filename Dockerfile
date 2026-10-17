# Prompt2Prod — one image for the API service (Cloud Run) and the agent runner (Cloud Run Job).

# ---- 1) dashboard (React + Vite)
FROM node:22-slim AS web
WORKDIR /web
COPY dashboard/package*.json ./
RUN npm ci --no-audit --no-fund
COPY dashboard/ ./
RUN npm run build

# ---- 2) runtime
FROM python:3.12-slim
RUN apt-get update && apt-get install -y --no-install-recommends git ca-certificates \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /srv
COPY backend/requirements.txt ./requirements.txt
# Sandbox toolchain for the demo projects is pre-installed so test runs start instantly.
RUN pip install --no-cache-dir -r requirements.txt \
    && pip install --no-cache-dir "flask==3.1.*" "gunicorn==23.*" "pytest==8.*"
COPY backend/p2p ./p2p
COPY backend/scripts ./scripts
COPY --from=web /web/dist ./static
ENV PYTHONUNBUFFERED=1 STATIC_DIR=/srv/static WORK_ROOT=/tmp/p2p
CMD exec uvicorn p2p.api:app --host 0.0.0.0 --port ${PORT:-8080} --workers 1 --proxy-headers
