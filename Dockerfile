FROM node:22-slim AS web
WORKDIR /web
COPY web/package.json web/package-lock.json ./
RUN npm ci
COPY web/ ./
RUN npm run build

FROM python:3.12-slim
RUN apt-get update \
    && apt-get install -y --no-install-recommends libgomp1 \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt
COPY run_pipeline.py pytest.ini ./
COPY shield/ shield/
COPY server/ server/
COPY tests/ tests/
COPY models/ models/
COPY reports/ reports/
COPY --from=web /web/dist web/dist
ENV SHIELD_DATA_DIR=/data \
    PYTHONUNBUFFERED=1
EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=3 \
    CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/api/meta', timeout=4)"
CMD ["python", "-m", "server", "--host", "0.0.0.0", "--port", "8000"]
