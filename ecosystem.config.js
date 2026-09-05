// PM2 process definition for the Sami Modern backend.
//
// Secrets are NOT defined here — the app reads them from the `.env` file in the
// project root (loaded by @nestjs/config) at startup. This file only sets the
// runtime mode. Start with:  pm2 start ecosystem.config.js
//
module.exports = {
  apps: [
    {
      name: 'sami-modern-be',
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
        NODE_ENV: 'production',
      },
    },
  ],
};
