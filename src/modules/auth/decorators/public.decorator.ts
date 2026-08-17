import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC_KEY = 'isPublic';

/**
 * Marks a route (or controller) as public, bypassing the global JwtAuthGuard.
 * Use sparingly — only for routes reachable without a token (e.g. login).
 */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
