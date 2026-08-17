import { registerAs } from '@nestjs/config';

/**
 * JWT authentication configuration.
 */
export default registerAs('jwt', () => ({
  secret: process.env.JWT_SECRET ?? 'change-me-in-env',
  expiresIn: process.env.JWT_EXPIRES_IN ?? '1d',
  refreshSecret: process.env.JWT_REFRESH_SECRET ?? 'change-me-refresh-in-env',
  refreshExpiresIn: process.env.JWT_REFRESH_EXPIRES_IN ?? '7d',
}));
