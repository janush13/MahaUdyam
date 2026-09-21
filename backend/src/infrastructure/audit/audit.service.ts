import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditAction } from './audit-actions.constant';

export interface RecordAuditEventInput {
  /** Null for events with no resolvable actor (e.g. a login attempt
   * against a nonexistent account is not audited at all — see the
   * caller — but a failed login against a real, existing account still
   * has userId set). */
  userId?: string | null;
  roleAtTime?: string | null;
  action: AuditAction;
  entityType: string;
  /** entity_id is a required UUID column — there must be a real entity to
   * reference. Never invent a placeholder id; skip the audit call instead
   * if there's genuinely nothing to reference. */
  entityId: string;
  beforeState?: Record<string, unknown> | null;
  afterState?: Record<string, unknown> | null;
  ipAddress: string;
  /** The approval-rule version the action relied on, as `<ruleId>@v<n>`
   * (audit_logs.rule_version_used). */
  ruleVersionUsed?: string | null;
}

/**
 * Minimal, write-only audit capability — NOT the full future AuditModule
 * (no read/query endpoints, no request-interceptor-based auto-logging of
 * every mutation yet). Just enough for Step 4's authentication events to
 * satisfy "use the existing audit_logs infrastructure." Never pass a
 * password, TOTP secret, or raw refresh token in beforeState/afterState —
 * callers are responsible for keeping those out.
 */
@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  async record(input: RecordAuditEventInput): Promise<void> {
    await this.prisma.auditLog.create({
      data: {
        userId: input.userId ?? null,
        roleAtTime: input.roleAtTime ?? null,
        action: input.action,
        entityType: input.entityType,
        entityId: input.entityId,
        beforeState: (input.beforeState as Prisma.InputJsonValue) ?? undefined,
        afterState: (input.afterState as Prisma.InputJsonValue) ?? undefined,
        ipAddress: input.ipAddress,
        ruleVersionUsed: input.ruleVersionUsed ?? null,
      },
    });
  }
}
