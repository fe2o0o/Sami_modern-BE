import { registerAs } from '@nestjs/config';

/**
 * Application-level configuration.
 * Consumed via `config.get('app.<key>')`.
 */
export default registerAs('app', () => ({
  env: process.env.NODE_ENV ?? 'development',
  port: parseInt(process.env.PORT ?? '3000', 10),
  apiPrefix: process.env.API_PREFIX ?? 'api/v1',
  name: process.env.APP_NAME ?? 'Sami Furniture Accountant API',
  /** Comma-separated list of allowed CORS origins, or `*`. */
  corsOrigins: process.env.CORS_ORIGINS ?? '*',
}));
