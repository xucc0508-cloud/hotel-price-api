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
for command_name in git node pnpm pm2 curl; do
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

log "Starting or reloading ${APP_NAME}..."
mkdir -p logs
if pm2 describe "${APP_NAME}" >/dev/null 2>&1; then
  pm2 reload ecosystem.config.js --env production --update-env
else
  pm2 start ecosystem.config.js --env production
fi
pm2 save

log "Checking ${HEALTH_URL}..."
for attempt in {1..15}; do
  if curl --fail --silent --show-error --max-time 5 \
    "${HEALTH_URL}" >/dev/null; then
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
