import { SetMetadata } from '@nestjs/common';

export const PERMISSIONS_KEY = 'required_permissions';

/**
 * Restrict a route (or controller) to principals holding ALL of the given
 * permission keys. A super-admin bypasses the check. With no decorator a route
 * only requires authentication.
 *
 * @example @RequirePermissions('sales_invoices.post')
 */
export const RequirePermissions = (...permissions: string[]) =>
  SetMetadata(PERMISSIONS_KEY, permissions);
