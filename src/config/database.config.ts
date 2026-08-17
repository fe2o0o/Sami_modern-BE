import { registerAs } from '@nestjs/config';

/**
 * Database (MySQL / TypeORM) configuration.
 *
 * DEV: `synchronize` is ON (auto-creates/updates tables) for fast iteration.
 * BEFORE PRODUCTION: set DB_SYNCHRONIZE=false and rely on migrations only
 * (an InitSchema migration is already generated as the baseline).
 */
export default registerAs('database', () => ({
  type: 'mysql' as const,
  host: process.env.DB_HOST ?? 'localhost',
  port: parseInt(process.env.DB_PORT ?? '3306', 10),
  username: process.env.DB_USERNAME ?? 'root',
  password: process.env.DB_PASSWORD ?? '',
  name: process.env.DB_DATABASE ?? 'sami_modern',
  synchronize: process.env.DB_SYNCHRONIZE !== 'false',
  logging: process.env.DB_LOGGING === 'true',
}));
