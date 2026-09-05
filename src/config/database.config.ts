import { registerAs } from '@nestjs/config';

/**
 * Database (MySQL / TypeORM) configuration.
 *
 * DEV: opt in to `synchronize` with DB_SYNCHRONIZE=true for fast iteration.
 * PRODUCTION: synchronize is ALWAYS off (guarded by NODE_ENV) — schema changes
 * are applied through migrations only (see src/database/migrations).
 */
export default registerAs('database', () => ({
  type: 'mysql' as const,
  host: process.env.DB_HOST ?? 'localhost',
  port: parseInt(process.env.DB_PORT ?? '3306', 10),
  username: process.env.DB_USERNAME ?? 'root',
  password: process.env.DB_PASSWORD ?? '',
  name: process.env.DB_DATABASE ?? 'sami_modern',
  // Explicit opt-in only, and never in production regardless of the flag.
  synchronize:
    process.env.NODE_ENV !== 'production' &&
    process.env.DB_SYNCHRONIZE === 'true',
  logging: process.env.DB_LOGGING === 'true',
}));
