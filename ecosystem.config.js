// PM2 process definition for the Sami Modern backend.
//
// The SERVER owns the environment: every checkout (production site, QC site)
// has its own `.env`, and `NODE_ENV` inside it says which one this is.
// PM2 only mirrors that value so the app name follows the environment:
//   NODE_ENV=production -> sami-modern-be   (api.samymodern.io,    branch `main`)
//   NODE_ENV=qc         -> sami-modern-qc   (api-qc.samymodern.io, branch `QC`)
// Secrets and PORT stay in `.env` (loaded by @nestjs/config at startup).
// Start with:  pm2 start ecosystem.config.js
//
const { parsed } = require('dotenv').config({ path: `${__dirname}/.env`, quiet: true });
const nodeEnv = (parsed && parsed.NODE_ENV) || 'production';

module.exports = {
  apps: [
    {
      name: nodeEnv === 'qc' ? 'sami-modern-qc' : 'sami-modern-be',
      script: 'dist/main.js',
      cwd: __dirname,
      exec_mode: 'fork',
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '512M',
      // Give in-flight requests time to drain on reload/stop (matches Nest's
      // enableShutdownHooks). PM2 sends SIGINT, then SIGKILL after this window.
      kill_timeout: 5000,
      env: {
        NODE_ENV: nodeEnv,
      },
    },
  ],
};
