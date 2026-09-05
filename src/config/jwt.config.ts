import { registerAs } from '@nestjs/config';

/**
 * Reads a required secret from the environment. There is NO insecure fallback:
 * a missing/empty secret is a fatal misconfiguration, so we fail fast at boot
 * rather than silently signing tokens with a guessable default.
 */
function requireSecret(key: 'JWT_SECRET' | 'JWT_REFRESH_SECRET'): string {
  const value = process.env[key];
  if (!value || value.trim().length === 0) {
    throw new Error(
      `${key} is required and must be set to a strong, non-empty value in the environment.`,
    );
  }
  return value;
}

/**
 * JWT authentication configuration. Secrets are mandatory (env-only); the
 * expiration windows keep their existing defaults and remain overridable.
 */
export default registerAs('jwt', () => ({
  secret: requireSecret('JWT_SECRET'),
  expiresIn: process.env.JWT_EXPIRES_IN ?? '1d',
  refreshSecret: requireSecret('JWT_REFRESH_SECRET'),
  refreshExpiresIn: process.env.JWT_REFRESH_EXPIRES_IN ?? '7d',
}));
