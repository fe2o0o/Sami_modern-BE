# Sami Modern ERP — Environments & Deployment

**Model:** the server owns the environment. Each environment is one Git branch + one server
checkout with its own `.env`. Nothing in the code knows a URL, a database name or a secret.

| Environment | Git branch | Backend checkout / URL | `.env` (on the server) | PM2 app | Frontend |
|---|---|---|---|---|---|
| development | feature branches | your machine · `http://localhost:3000` | `NODE_ENV=development`, local DB | — | `ng serve` (dev.env.ts → localhost:3000) |
| qc | `QC` | `~/htdocs/api-qc.samymodern.io` · `https://api-qc.samymodern.io` | `NODE_ENV=qc`, `PORT=3001`, `DB_DATABASE=qcDB`, `CORS_ORIGINS=https://qc.samymodern.io`, own JWT/OpenAI secrets | `sami-modern-qc` | `npm run build:qc` → FTP to `qc.samymodern.io` |
| production | `main` (BE) / `master` (FE) | `~/htdocs/api.samymodern.io` · `https://api.samymodern.io` | `NODE_ENV=production`, `PORT=3000`, `DB_DATABASE=prod`, `CORS_ORIGINS=https://samymodern.io` | `sami-modern-be` | `npm run build:prod` → FTP to `samymodern.io` |

## Backend
- Configuration is centralized in `src/config/*` (`app`, `database`, `jwt`, `swagger`, `ai`) and
  validated at boot (`env.validation.ts`). Required: `DB_HOST DB_PORT DB_USERNAME DB_DATABASE
  JWT_SECRET JWT_REFRESH_SECRET`. No fallback secrets. `synchronize` is never on in production.
- **Isolation guard:** `NODE_ENV=qc` refuses to start unless `DB_DATABASE` contains `qc`;
  `NODE_ENV=production` refuses a database named like `qc|test|dev|staging`.
- `ecosystem.config.js` reads `NODE_ENV` from the checkout's `.env` and names the PM2 app
  accordingly (`sami-modern-be` / `sami-modern-qc`), so both can run on the same VPS. The production checkout tracks `main`, the QC checkout tracks `QC`.
- `deploy.sh` (run inside the checkout): `git pull` of the tracked branch → `npm ci` → `npm run
  build` → `npm run migration:run:prod` (compiled migrations against *this* checkout's DB) →
  `pm2 startOrReload ecosystem.config.js`.
- `OPENAI_API_KEY` lives only in the backend `.env`; the Angular app calls `/ai/chat` on the API.
- Templates: `.env.example` (documents every variable, with the production/qc values in comments).
  Real `.env*` files are git-ignored.

### First-time QC setup (server)
```bash
# MySQL
CREATE DATABASE qcDB CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER 'qcDB'@'127.0.0.1' IDENTIFIED BY '<qc-password>';
GRANT ALL PRIVILEGES ON qcDB.* TO 'qcDB'@'127.0.0.1'; FLUSH PRIVILEGES;

# CloudPanel: Node.js site api-qc.samymodern.io → App Port 3001
cd ~/htdocs/api-qc.samymodern.io
git clone -b QC <repo-url> .
cp .env.example .env && nano .env        # NODE_ENV=qc PORT=3001 DB_*=qcDB CORS_ORIGINS=https://qc.samymodern.io + NEW JWT secrets
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"   # run twice for the two JWT secrets
chmod +x deploy.sh && ./deploy.sh        # build + migrations + pm2 start sami-modern-qc
npm run seed:prod                        # first time only (compiled seeders → this checkout's DB)
pm2 logs sami-modern-qc --lines 20
```
Production keeps its existing checkout (branch `main`) and `.env` untouched; deploy with `./deploy.sh`.

## Frontend
`angular.json` configurations swap `src/env/dev.env.ts` for `qc.env.ts` / `prod.env.ts`
(public values only: API URL, labels, currency — never secrets).
```bash
npm start              # development (localhost:3000)
npm run start:qc       # local UI against the QC API
npm run build:qc       # dist/furniture_acc/browser → upload to qc.samymodern.io   (shows the orange "QC ENVIRONMENT" badge)
npm run build:prod     # dist/furniture_acc/browser → upload to samymodern.io      (no badge)
```

## Branch flow
- **Production = `main`** (backend) / **`master`** (frontend). **QC = `QC`** in both repos.
- Work on feature branches → merge into `QC` → QC server `./deploy.sh` (BE) + `npm run build:qc` → FTP (FE)
  → after sign-off merge `QC` into `main`/`master` → production server `./deploy.sh` + `npm run build:prod` → FTP.
- Hotfixes land on `main`/`master` and are merged back into `QC`.

## Verification
- `pm2 logs sami-modern-qc` shows port 3001; `pm2 logs sami-modern-be` shows port 3000.
- `SELECT DATABASE()` through each API (e.g. any list endpoint) hits `qcDB` vs `prod`.
- The QC frontend shows the **QC ENVIRONMENT** badge next to the page title; production does not.
