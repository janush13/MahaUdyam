import { ConflictException, Injectable } from '@nestjs/common';
import { InternalApplicationState, Prisma } from '@prisma/client';
import { ErrorCodes } from '../../common/constants/error-codes.constant';
import { AuditActions } from '../../infrastructure/audit/audit-actions.constant';
import { applicantStatusFor } from '../applications/application-state.machine';
import {
  RecommendationBlock,
  loadInspectionFacts,
  recommendationBlock,
} from '../inspections/inspection-gate';
import { NotificationEventsService } from '../notifications/notification-events.service';
import { OfficerAccessService } from '../officer/officer-access.service';
import { ScrutinySupport } from '../officer/scrutiny-support.service';
import {
  DECIDED_STATES,
  DecisionTransition,
  actionForOutcome,
  findDecisionTransition,
} from './decision-state.machine';
import { DECISION_INCLUDE, toDecisionDto } from './decision.mappers';
import { DecideDto } from './dto/decision-request.dto';
import { DecisionResultDto } from './dto/decision-response.dto';

const DECISION_BLOCK_MESSAGES: Record<RecommendationBlock, string> = {
  INSPECTION_OPEN:
    'An inspection of this application is still pending or scheduled; it must be completed before a decision can be made.',
  INSPECTION_REQUIRED:
    'This approval requires an inspection and none has been completed, so a decision cannot be made.',
};

/** The transition `action` performs from `from`, or a 409 - the client never
 * names a target state. A state that is already past the decision gets the
 * specific "already decided" answer, so a duplicate or racing decision is
 * clearly not a malformed one. */
export function decisionTransitionFor(
  action: DecisionTransition['action'],
  from: InternalApplicationState,
): DecisionTransition {
  const transition = findDecisionTransition(action, from);
  if (transition) {
    return transition;
  }
  if (
    (action === 'APPROVE' || action === 'REJECT') &&
    DECIDED_STATES.includes(from)
  ) {
    throw new ConflictException({
      code: ErrorCodes.DECISION_ALREADY_RECORDED,
      message:
        'A decision has already been recorded for this application; a decision is made once.',
    });
  }
  throw new ConflictException({
    code: ErrorCodes.INVALID_STATE_TRANSITION,
    message: `This action is not available while the application is in its current state (${from}).`,
  });
}

/**
 * Applies a validated decision-flow transition as a GUARDED update
 * (`WHERE internal_state = <from>`) and moves the derived applicant-facing
 * status with it. `extra` carries the decision's own columns (decided_at,
 * decision_reason) when the transition is the decision itself.
 */
export async function applyDecisionTransition(
  tx: Prisma.TransactionClient,
  applicationId: string,
  transition: DecisionTransition,
  extra: Prisma.ApprovalApplicationUpdateManyMutationInput = {},
): Promise<void> {
  const applicantStatus = applicantStatusFor(transition.to);
  if (!applicantStatus) {
    // Unreachable for the defined transitions; fail closed rather than guess.
    throw new ConflictException({
      code: ErrorCodes.INVALID_STATE_TRANSITION,
      message: 'No applicant-facing status is defined for this transition.',
    });
  }
  const { count } = await tx.approvalApplication.updateMany({
    where: { id: applicationId, internalState: transition.from },
    data: {
      internalState: transition.to,
      applicantStatus,
      updatedAt: new Date(),
      ...extra,
    },
  });
  if (count !== 1) {
    throw new ConflictException({
      code: ErrorCodes.CONFLICT,
      message:
        'The application changed while this action was being processed. Reload it and try again.',
    });
  }
}

/**
 * The Approving Authority's decision on an application (FRD 4.5 / 22.1,
 * TRD 3.2 / 28, Blueprint 20.2 "Statutory decision: Full" for the Approving
 * Authority only).
 *
 * WHO. `OfficerAccessService` decides, BEFORE the transaction, that the caller
 * holds APPROVING_AUTHORITY for the application's OWN department (derived from
 * its approval type, never from the client) and can see the application - the
 * same 404-not-403 convention as the rest of the officer API - and that the
 * role has the DECIDE capability. Scrutiny officers, department
 * administrators, inspectors, system administrators and applicants have none.
 *
 * WHAT. One explicit domain action, `decide(outcome, reason)`. The route takes
 * no status, no recommendation and no identity: the recommendation answered is
 * the latest one ON RECORD, read here inside the transaction. Nothing here
 * writes a recommendation, and a recommendation is never altered - the decision
 * is its own append-only row that merely REFERENCES it, so recommendation and
 * statutory decision stay two distinct records (FRD 22.1 "scrutiny never
 * itself finalises a statutory outcome").
 *
 * PREREQUISITES (all documented, none invented): the application is
 * RECOMMENDED_FOR_APPROVAL (scrutiny finished; TRD 3.2), a recommendation is on
 * record, the inspection gate still holds (TRD 3.3: inspection before the
 * recommendation, and FRD 4.5 "review completed scrutiny and inspection
 * outcomes"), and a reason is given (FRD 4.5 "mandatory recorded reason").
 * There is deliberately NO approval criterion: whether to approve is the
 * authority's, and may differ from the recommendation.
 *
 * HOW. The application row is locked (`SELECT ... FOR UPDATE`, via
 * ScrutinySupport.run) and everything is re-checked under the lock; the state
 * change is a guarded UPDATE; the decision row is unique per application and
 * the database itself refuses a decision on anything but a recommended
 * application. Two authorities racing therefore produce exactly one decision;
 * the loser gets 409 DECISION_ALREADY_RECORDED. Audit and notification are
 * written after the commit, like every other transition.
 */
@Injectable()
export class DecisionService {
  constructor(
    private readonly access: OfficerAccessService,
    private readonly support: ScrutinySupport,
    private readonly notifications: NotificationEventsService,
  ) {}

  async decide(
    userId: string,
    applicationId: string,
    dto: DecideDto,
    ipAddress: string,
  ): Promise<DecisionResultDto> {
    const ctx = await this.access.resolveApplication(
      userId,
      applicationId,
      'DECIDE',
    );
    const action = actionForOutcome(dto.outcome);

    const done = await this.support.run(ctx, async (tx, locked) => {
      const transition = decisionTransitionFor(action, locked.internalState);

      // TRD 3.3 / FRD 4.5: the inspection gate that admitted the
      // recommendation must still hold. Read under the application lock, the
      // same one an inspector's completion or a new request takes.
      const block = recommendationBlock(
        await loadInspectionFacts(tx, ctx.app.id),
      );
      if (block) {
        throw new ConflictException({
          code: ErrorCodes[block],
          message: DECISION_BLOCK_MESSAGES[block],
        });
      }

      // The recommendation being answered: the latest on record. It is only
      // READ - a decision never creates or edits one.
      const recommendation = await tx.scrutinyRecommendation.findFirst({
        where: { applicationId: ctx.app.id },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      });
      if (!recommendation) {
        throw new ConflictException({
          code: ErrorCodes.RECOMMENDATION_NOT_FOUND,
          message:
            'There is no scrutiny recommendation on record for this application, so there is nothing to decide on.',
        });
      }

      const decidedAt = new Date();
      const decision = await tx.approvalDecision.create({
        data: {
          applicationId: ctx.app.id,
          departmentId: ctx.departmentId,
          recommendationId: recommendation.id,
          outcome: dto.outcome,
          reason: dto.reason,
          decidedByUserId: userId,
          decidedAt,
        },
        include: DECISION_INCLUDE,
      });
      await applyDecisionTransition(tx, ctx.app.id, transition, {
        decidedAt,
        decisionReason: dto.reason,
      });
      return { transition, decision };
    });

    const { transition, decision } = done;
    await this.support.recordOfficerEvent(
      ctx,
      AuditActions.APPLICATION_DECISION_RECORDED,
      {
        decisionId: decision.id,
        outcome: decision.outcome,
        reason: decision.reason,
        decidedAt: decision.decidedAt,
        // The recommendation answered, and whether the decision followed it.
        recommendationId: decision.recommendationId,
        recommendedOutcome: decision.recommendation.outcome,
        differsFromRecommendation:
          decision.recommendation.outcome !== decision.outcome,
        // A decision, unlike the recommendation it answers, is statutory.
        isRecommendationOnly: false,
      },
      ipAddress,
    );
    await this.support.recordOfficerEvent(
      ctx,
      AuditActions.APPLICATION_STATUS_CHANGED,
      {
        action: transition.action,
        internalState: transition.to,
        applicantStatus: applicantStatusFor(transition.to),
        decisionId: decision.id,
      },
      ipAddress,
      {
        internalState: transition.from,
        applicantStatus: applicantStatusFor(transition.from),
      },
    );
    if (decision.outcome === 'APPROVE') {
      await this.notifications.approvalIssued(ctx.app.id, decision.id);
    } else {
      await this.notifications.applicationRejected(ctx.app.id, decision.id);
    }
    return {
      applicationId: ctx.app.id,
      internalState: transition.to,
      applicantStatus: applicantStatusFor(transition.to),
      decision: toDecisionDto(decision),
    };
  }
}
