/**
 * System roles used for authorization.
 *
 * Lives in `common` (not a feature module) because guards, decorators and the
 * JWT payload all depend on it. The dedicated Roles/Permissions modules (added
 * later) will manage persistence; this enum stays the source of truth for the
 * built-in role names.
 */
export enum UserRole {
  SUPER_ADMIN = 'SUPER_ADMIN',
  ADMIN = 'ADMIN',
  ACCOUNTANT = 'ACCOUNTANT',
  USER = 'USER',
}
