#!/usr/bin/env bash
#
# Production deploy for the Sami Modern backend.
# Run from the project root on the server (as the CloudPanel site user):
#   ./deploy.sh
#
# It pulls the latest code, installs, builds, applies any PENDING migrations,
# and reloads the PM2 process. Migrations run as a controlled step here — never
# automatically inside the app.
#
set -euo pipefail

echo "→ Pulling latest code..."
git pull --ff-only

echo "→ Installing dependencies (npm ci)..."
npm ci

echo "→ Building..."
npm run build

echo "→ Applying pending migrations..."
npm run migration:run:prod

echo "→ Reloading PM2 process..."
pm2 reload ecosystem.config.js --update-env

echo "✓ Deploy complete."
