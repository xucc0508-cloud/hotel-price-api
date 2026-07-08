#!/usr/bin/env bash

set -Eeuo pipefail

APP_NAME="hotel-price-api"
BRANCH="main"
HEALTH_URL="${HEALTH_URL:-http://127.0.0.1:3000/health}"
PROJECT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
LOCK_FILE="/tmp/${APP_NAME}.deploy.lock"

log() {
  printf '[%s] %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$*"
}

fail() {
  log "ERROR: $*"
  exit 1
}

trap 'fail "Deployment failed at line ${LINENO}."' ERR

cd "${PROJECT_DIR}"

exec 9>"${LOCK_FILE}"
flock -n 9 || fail "Another deployment is already running."

log "Checking deployment prerequisites..."
for command_name in git node pnpm pm2 curl flock; do
  command -v "${command_name}" >/dev/null 2>&1 ||
    fail "${command_name} is not installed."
done

[[ -d .git ]] || fail "${PROJECT_DIR} is not a Git repository."
[[ -f package.json ]] || fail "package.json is missing."
[[ -f pnpm-lock.yaml ]] ||
  fail "pnpm-lock.yaml is missing; refusing an unlocked deployment."
[[ -f ecosystem.config.js ]] || fail "ecosystem.config.js is missing."

if [[ ! -f .env ]]; then
  log "WARNING: .env is missing; PM2/system environment variables will be used."
fi

if ! git diff --quiet || ! git diff --cached --quiet; then
  fail "Tracked local changes exist. Commit or discard them before deploying."
fi

log "Pulling origin/${BRANCH} with fast-forward only..."
git pull --ff-only origin "${BRANCH}"

log "Installing dependencies from pnpm-lock.yaml..."
pnpm install --frozen-lockfile

log "Loading environment variables from .env..."
set -a
[ -f .env ] && . ./.env
set +a

log "Starting or reloading ${APP_NAME}..."
mkdir -p logs
pm2 startOrReload ecosystem.config.js --env production --update-env
pm2 describe "${APP_NAME}" >/dev/null
pm2 save

configure_nginx_ip_proxy() {
  if [[ ! -f nginx/hotel-price-api.conf ]]; then
    log "WARNING: nginx/hotel-price-api.conf is missing; skipping Nginx IP proxy setup."
    return
  fi

  if ! command -v nginx >/dev/null 2>&1; then
    log "WARNING: nginx is not installed; skipping Nginx IP proxy setup."
    return
  fi

  if ! command -v sudo >/dev/null 2>&1; then
    fail "sudo is required to install the Nginx IP proxy config."
  fi

  log "Installing Nginx IP proxy config for port 80..."
  sudo -n cp nginx/hotel-price-api.conf /etc/nginx/sites-available/hotel-price-api
  sudo -n ln -sfn /etc/nginx/sites-available/hotel-price-api \
    /etc/nginx/sites-enabled/hotel-price-api
  if [[ -e /etc/nginx/sites-enabled/default ]]; then
    sudo -n rm -f /etc/nginx/sites-enabled/default
  fi
  sudo -n nginx -t
  sudo -n systemctl reload nginx

  if command -v ufw >/dev/null 2>&1; then
    log "Ensuring local firewall allows HTTP/HTTPS..."
    sudo -n ufw allow 80/tcp >/dev/null || true
    sudo -n ufw allow 443/tcp >/dev/null || true
    sudo -n ufw status || true
  fi

  log "Current port 80/443 listeners..."
  ss -tlnp 2>/dev/null | grep -E ':(80|443)[[:space:]]' || true

  log "Checking Nginx local proxy http://127.0.0.1/health..."
  curl --fail --silent --show-error --max-time 5 http://127.0.0.1/health
  echo

  log "Checking Nginx public-IP path from server network..."
  curl --silent --show-error --max-time 5 http://82.156.240.45/health || true
  echo

  log "Recent Nginx access log entries..."
  sudo -n tail -n 20 /var/log/nginx/hotel-price-api.access.log 2>/dev/null || true
  log "Recent Nginx error log entries..."
  sudo -n tail -n 20 /var/log/nginx/hotel-price-api.error.log 2>/dev/null || true
}

configure_nginx_ip_proxy

log "Checking ${HEALTH_URL}..."
for attempt in {1..15}; do
  if health_response="$(curl --fail --silent --show-error --max-time 5 \
    "${HEALTH_URL}")"; then
    printf '%s\n' "${health_response}"
    log "Deployment completed successfully."
    pm2 status "${APP_NAME}"
    exit 0
  fi

  if [[ "${attempt}" -lt 15 ]]; then
    log "Health check ${attempt}/15 failed; retrying in 2 seconds."
    sleep 2
  fi
done

pm2 logs "${APP_NAME}" --lines 50 --nostream || true
fail "Health check failed after 15 attempts."
