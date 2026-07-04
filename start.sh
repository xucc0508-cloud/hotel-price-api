#!/usr/bin/env bash

set -Eeuo pipefail

MODE="${1:-production}"
PROJECT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
cd "${PROJECT_DIR}"

echo "Checking runtime..."
command -v node >/dev/null 2>&1 || {
  echo "ERROR: Node.js is not installed."
  exit 1
}
command -v pnpm >/dev/null 2>&1 || {
  echo "ERROR: pnpm is not installed."
  exit 1
}

if [[ ! -d node_modules ]]; then
  echo "Installing dependencies..."
  pnpm install --frozen-lockfile
fi

case "${MODE}" in
  dev | development)
    echo "Starting hotel-price-api in development mode..."
    exec pnpm dev
    ;;
  prod | production)
    if command -v pm2 >/dev/null 2>&1; then
      echo "Starting hotel-price-api with PM2..."
      mkdir -p logs
      pm2 startOrReload ecosystem.config.js --env production
      pm2 save
    else
      echo "PM2 is unavailable; starting directly with Node.js..."
      export NODE_ENV=production
      exec pnpm start
    fi
    ;;
  *)
    echo "ERROR: Unknown mode '${MODE}'. Use development or production."
    exit 1
    ;;
esac
