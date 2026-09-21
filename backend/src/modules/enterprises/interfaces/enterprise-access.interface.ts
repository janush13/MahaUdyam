import { Enterprise, RepresentativeScope } from '@prisma/client';
import { AuthenticatedRequest } from '../../auth/interfaces/authenticated-request.interface';

export interface EnterpriseAccess {
  enterprise: Enterprise;
  relation: 'OWNER' | 'REPRESENTATIVE';
  /** Set only when relation is REPRESENTATIVE. */
  scope?: RepresentativeScope;
  /** Empty = unrestricted (every project of the enterprise). */
  scopedProjectIds: string[];
}

export interface EnterpriseAccessRequest extends AuthenticatedRequest {
  enterpriseAccess?: EnterpriseAccess;
}
