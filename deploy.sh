#!/usr/bin/env bash
#
# Deploy the Sami Modern backend for THIS checkout.
# Run from the project root on the server (as the CloudPanel site user):
#   ./deploy.sh
#
# Which environment this is comes from the checkout itself:
#   - the git branch the site tracks (`main` = production, or `QC`)
#   - the site's own `.env` (NODE_ENV, PORT, DB_*, JWT_*, CORS_ORIGINS, ...)
# It pulls the tracked branch, installs, builds, applies any PENDING migrations
# against this checkout's database, and starts/reloads its PM2 app.
# Migrations run as a controlled step here - never automatically inside the app.
#
set -euo pipefail

[[ -f .env ]] || { echo "x No .env in $(pwd) - create it from .env.example first"; exit 1; }
NODE_ENV_FILE="$(grep -E '^NODE_ENV=' .env | tail -1 | cut -d= -f2 | tr -d '[:space:]' || true)"
BRANCH="$(git rev-parse --abbrev-ref HEAD)"
case "${NODE_ENV_FILE:-production}" in
  production) APP="sami-modern-be" ;;
  qc)         APP="sami-modern-qc" ;;
  *) echo "x .env has NODE_ENV=${NODE_ENV_FILE} - expected production or qc"; exit 1 ;;
esac
echo "-> Deploying ${NODE_ENV_FILE:-production} from branch '$BRANCH' (pm2 app: $APP)"

echo "-> Pulling latest code..."
git pull --ff-only

echo "-> Installing dependencies (npm ci)..."
npm ci

echo "-> Building..."
npm run build

echo "-> Applying pending migrations..."
npm run migration:run:prod

echo "-> Starting/reloading PM2 process $APP..."
pm2 startOrReload ecosystem.config.js --update-env
pm2 save >/dev/null 2>&1 || true

echo "OK Deploy complete ($APP)."
