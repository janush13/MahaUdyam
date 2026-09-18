import { SetMetadata } from '@nestjs/common';

export const ROLES_KEY = 'roles';

/** Route requires the caller to hold at least one of the listed role
 * codes. Checked by RolesGuard against the database, not against JWT
 * claims — see jwt-payload.interface.ts for why. */
export const Roles = (...roles: string[]) => SetMetadata(ROLES_KEY, roles);
