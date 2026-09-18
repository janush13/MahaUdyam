import { SetMetadata } from '@nestjs/common';

export const PERMISSIONS_KEY = 'permissions';

/** Route requires the caller to hold at least one of the listed
 * permission codes (capabilities, not UI pages — see the permission
 * catalogue in prisma/seed.ts). Checked by PermissionsGuard against the
 * database. */
export const Permissions = (...permissions: string[]) =>
  SetMetadata(PERMISSIONS_KEY, permissions);
