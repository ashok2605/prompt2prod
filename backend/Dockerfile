FROM python:3.12-slim
RUN apt-get update && apt-get install -y --no-install-recommends git ca-certificates \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /srv
COPY requirements.txt ./requirements.txt
RUN pip install --no-cache-dir -r requirements.txt \
    && pip install --no-cache-dir "flask==3.1.*" "gunicorn==23.*" "pytest==8.*" "playwright==1.*" \
    && python -m playwright install --with-deps --only-shell chromium \
    && rm -rf /var/lib/apt/lists/*
COPY p2p ./p2p
COPY scripts ./scripts
ENV PYTHONUNBUFFERED=1 WORK_ROOT=/tmp/p2p
CMD exec uvicorn p2p.api:app --host 0.0.0.0 --port ${PORT:-8080} --workers 1 --proxy-headers
