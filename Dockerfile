# syntax=docker/dockerfile:1

# 1) Build the Three.js client (minified, hashed bundles in /build/client/dist); it imports the game rules from ../shared
FROM node:22-alpine AS client
WORKDIR /build/client
COPY client/package.json client/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY shared/ /build/shared/
COPY client/ ./
RUN npm run build

# 2) Django API + the built client, served by gunicorn and WhiteNoise
FROM python:3.12-slim
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    FRONTEND_DIR=/app/frontend
WORKDIR /app/server
COPY server/requirements.txt ./
RUN pip install -r requirements.txt
COPY server/ ./
COPY --from=client /build/client/dist /app/frontend
# Pre-compress static files (gzip + brotli) at build time so requests never pay for it.
RUN DJANGO_SECRET_KEY=collectstatic-only python manage.py collectstatic --noinput \
 && useradd --system --uid 10001 app
USER app
EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=3s --start-period=20s \
  CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/api/health', timeout=2)"
CMD ["sh", "-c", "python manage.py migrate --noinput && exec gunicorn frontline.wsgi:application --bind 0.0.0.0:8000 --workers ${WEB_CONCURRENCY:-3} --access-logfile -"]
