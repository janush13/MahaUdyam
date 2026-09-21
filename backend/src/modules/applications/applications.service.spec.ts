import {
  BadRequestException,
  ConflictException,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { ErrorCodes } from '../../common/constants/error-codes.constant';
import { AuditActions } from '../../infrastructure/audit/audit-actions.constant';
import { AuditService } from '../../infrastructure/audit/audit.service';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { EnterpriseAccess } from '../enterprises/interfaces/enterprise-access.interface';
import { ApplicationsService } from './applications.service';

const ENTERPRISE = '00000000-0000-4000-8000-0000000000c3';
const PROJECT = '00000000-0000-4000-8000-0000000000e5';
const OTHER_PROJECT = '00000000-0000-4000-8000-0000000000e6';
const ACTOR = '00000000-0000-4000-8000-0000000000a1';
const TYPE = '10000000-0000-4000-8000-000000000001';
const SNAPSHOT = '20000000-0000-4000-8000-000000000001';
const WORKFLOW = '30000000-0000-4000-8000-000000000001';
const APP = '40000000-0000-4000-8000-000000000001';
const RULE = '90000000-0000-4000-8000-000000000001';

const ownerAccess = {
  relation: 'OWNER',
  enterprise: { id: ENTERPRISE },
  scopedProjectIds: [],
} as unknown as EnterpriseAccess;

const repAccess = (scopedProjectIds: string[] = []) =>
  ({
    relation: 'REPRESENTATIVE',
    scope: 'PREPARE_SUBMIT',
    enterprise: { id: ENTERPRISE },
    scopedProjectIds,
  }) as unknown as EnterpriseAccess;

const applicableEntry = {
  approvalType: { id: TYPE, name: 'Type A' },
  department: { id: 'd1', code: 'DEPT-A', name: 'Dept A' },
  rule: {
    id: RULE,
    version: 2,
    priority: 100,
    effectiveFrom: '2026-01-01T00:00:00.000Z',
    effectiveTo: null,
    sourceReference: 'TBD',
  },
  label: 'POTENTIALLY_APPLICABLE',
  explanation: 'Shown because: x.',
};

const snapshotRow = {
  id: SNAPSHOT,
  projectId: PROJECT,
  evaluatedAt: new Date('2026-09-19T10:00:00.000Z'),
  engineVersion: '1.0.0',
  result: { applicable: [applicableEntry], notApplicable: [] },
};

const applicationRow = (over: Record<string, unknown> = {}) => ({
  id: APP,
  projectId: PROJECT,
  approvalTypeId: TYPE,
  workflowId: WORKFLOW,
  internalState: 'DRAFT',
  applicantStatus: 'READY_TO_SUBMIT',
  referenceNumber: null,
  submittedAt: null,
  submittedByUserId: null,
  declarationAcceptedAt: null,
  createdByUserId: ACTOR,
  discoverySnapshotId: SNAPSHOT,
  discoveryContext: {
    snapshotId: SNAPSHOT,
    snapshotEvaluatedAt: '2026-09-19T10:00:00.000Z',
    engineVersion: '1.0.0',
    recommendationLabel: 'POTENTIALLY_APPLICABLE',
    rule: { id: RULE, version: 2, sourceReference: 'TBD' },
    department: { id: 'd1', code: 'DEPT-A', name: 'Dept A' },
    explanation: 'Shown because: x.',
  },
  formData: { a: 'old' },
  createdAt: new Date('2026-09-19T10:00:00.000Z'),
  updatedAt: new Date('2026-09-19T10:05:00.000Z'),
  approvalType: {
    id: TYPE,
    name: 'Type A',
    legalName: null,
    isActive: true,
    department: { id: 'd1', code: 'DEPT-A', name: 'Dept A' },
  },
  project: { referenceNumber: 'PRJ-2026-000001', enterpriseId: ENTERPRISE },
  ...over,
});

function build(
  opts: {
    project?: object | null;
    snapshot?: object | null;
    approvalType?: object | null;
    workflow?: object | null;
    existingLive?: object | null;
    application?: object | null;
    updateCount?: number;
    mandatory?: Array<{ id: string; name: string }>;
    linkedRequirementIds?: string[];
    /** Current documents that are expired / rejected. */
    documentIssueRows?: Array<{
      id: string;
      originalFilename: string;
      status: string;
    }>;
    /** Full document rows returned for the submission snapshot. */
    snapshotDocuments?: Array<Record<string, unknown>>;
  } = {},
) {
  const has = (k: keyof typeof opts) => k in opts;
  // Submission now updates inside a transaction (the SLA clock starts in it),
  // so the transaction and the client share one recorded `updateMany`.
  const updateMany = jest
    .fn()
    .mockResolvedValue({ count: opts.updateCount ?? 1 });
  const tx = {
    $executeRaw: jest.fn().mockResolvedValue(1),
    approvalApplication: {
      updateMany,
      findFirst: jest
        .fn()
        .mockResolvedValue(has('existingLive') ? opts.existingLive : null),
      create: jest.fn().mockImplementation(({ data }) =>
        Promise.resolve(
          applicationRow({
            ...data,
            id: APP,
            applicantStatus: data.applicantStatus,
          }),
        ),
      ),
    },
  };
  const prisma = {
    project: {
      findFirst: jest
        .fn()
        .mockResolvedValue(has('project') ? opts.project : { id: PROJECT }),
    },
    discoverySnapshot: {
      findFirst: jest
        .fn()
        .mockResolvedValue(has('snapshot') ? opts.snapshot : snapshotRow),
    },
    approvalType: {
      findUnique: jest.fn().mockResolvedValue(
        has('approvalType')
          ? opts.approvalType
          : {
              id: TYPE,
              name: 'Type A',
              isActive: true,
            },
      ),
    },
    workflow: {
      findFirst: jest
        .fn()
        .mockResolvedValue(
          has('workflow') ? opts.workflow : { id: WORKFLOW, version: 4 },
        ),
    },
    documentRequirement: {
      findMany: jest.fn().mockResolvedValue(opts.mandatory ?? []),
    },
    // One table, three different questions - answer each on its own terms so
    // a regression in any of them cannot hide behind the others.
    applicationDocument: {
      findMany: jest.fn().mockImplementation((args: any) => {
        if (args.select?.document === true) {
          return Promise.resolve(
            (opts.snapshotDocuments ?? []).map((document) => ({ document })),
          );
        }
        // "Which requirements are satisfied?" filters by requirement id.
        if (args.where?.document?.documentRequirementId) {
          return Promise.resolve(
            (opts.linkedRequirementIds ?? []).map((id) => ({
              document: { documentRequirementId: id },
            })),
          );
        }
        // "Which current documents need replacing?" has no requirement filter.
        return Promise.resolve(
          (opts.documentIssueRows ?? []).map((document) => ({ document })),
        );
      }),
    },
    approvalApplication: {
      findFirst: jest
        .fn()
        .mockResolvedValue(
          has('application') ? opts.application : applicationRow(),
        ),
      findMany: jest.fn().mockResolvedValue([applicationRow()]),
      updateMany,
    },
    $transaction: jest.fn().mockImplementation((fn) => fn(tx)),
    $queryRaw: jest.fn().mockResolvedValue([{ ref: 'APP-2026-000042' }]),
  };
  const audit = { record: jest.fn().mockResolvedValue(undefined) };
  const sla = {
    startAtSubmission: jest.fn().mockResolvedValue([]),
    record: jest.fn().mockResolvedValue(undefined),
  };
  const notifications = {
    applicationSubmitted: jest.fn().mockResolvedValue(undefined),
  };
  const service = new ApplicationsService(
    prisma as unknown as PrismaService,
    audit as unknown as AuditService,
    sla as never,
    notifications as never,
  );
  return { service, prisma, tx, audit, sla, notifications };
}

const createDto = (extra: Record<string, unknown> = {}) => ({
  approvalTypeId: TYPE,
  discoverySnapshotId: SNAPSHOT,
  ...extra,
});

const submitDto = { declarationAccepted: true as const };

async function thrown(promise: Promise<unknown>): Promise<any> {
  try {
    await promise;
  } catch (e) {
    return e;
  }
  throw new Error('expected the call to throw');
}

describe('ApplicationsService', () => {
  // -----------------------------------------------------------------------
  describe('create', () => {
    it('creates a DRAFT bound to the authorised project, the snapshot and the pinned workflow', async () => {
      const { service, tx } = build();
      const res = await service.create(
        ownerAccess,
        PROJECT,
        ACTOR,
        createDto({ formData: { a: 'x' } }),
        '1.2.3.4',
      );

      const data = tx.approvalApplication.create.mock.calls[0][0].data;
      expect(data).toMatchObject({
        projectId: PROJECT,
        approvalTypeId: TYPE,
        workflowId: WORKFLOW,
        internalState: 'DRAFT',
        discoverySnapshotId: SNAPSHOT,
        createdByUserId: ACTOR,
        formData: { a: 'x' },
      });
      expect(data.discoveryContext).toMatchObject({
        snapshotId: SNAPSHOT,
        rule: { id: RULE, version: 2 },
        recommendationLabel: 'POTENTIALLY_APPLICABLE',
      });
      expect(res.id).toBe(APP);
      expect(res.discovery?.note).toMatch(/not a statutory determination/i);
    });

    it('derives Ready to Submit when nothing mandatory is outstanding', async () => {
      const { service, tx } = build();
      await service.create(ownerAccess, PROJECT, ACTOR, createDto(), 'ip');
      expect(
        tx.approvalApplication.create.mock.calls[0][0].data.applicantStatus,
      ).toBe('READY_TO_SUBMIT');
    });

    it('derives Draft when a mandatory document requirement is configured and unmet', async () => {
      const { service, tx } = build({
        mandatory: [{ id: 'req-1', name: 'Identity proof' }],
      });
      await service.create(ownerAccess, PROJECT, ACTOR, createDto(), 'ip');
      expect(
        tx.approvalApplication.create.mock.calls[0][0].data.applicantStatus,
      ).toBe('DRAFT');
    });

    it('looks the project and the snapshot up inside the authorised enterprise/project only', async () => {
      const { service, prisma } = build();
      await service.create(ownerAccess, PROJECT, ACTOR, createDto(), 'ip');
      expect(prisma.project.findFirst).toHaveBeenCalledWith({
        where: { id: PROJECT, enterpriseId: ENTERPRISE },
      });
      expect(prisma.discoverySnapshot.findFirst).toHaveBeenCalledWith({
        where: { id: SNAPSHOT, projectId: PROJECT },
      });
    });

    it('audits creation with actor, enterprise/project, acting relationship and the rule version', async () => {
      const { service, audit } = build();
      await service.create(repAccess(), PROJECT, ACTOR, createDto(), '9.9.9.9');
      expect(audit.record).toHaveBeenCalledTimes(1);
      const event = audit.record.mock.calls[0][0];
      expect(event).toMatchObject({
        userId: ACTOR,
        roleAtTime: 'APPLICANT',
        action: AuditActions.APPLICATION_CREATED,
        entityType: 'ApprovalApplication',
        entityId: APP,
        ipAddress: '9.9.9.9',
        ruleVersionUsed: `${RULE}@v2`,
      });
      expect(event.afterState).toMatchObject({
        enterpriseId: ENTERPRISE,
        projectId: PROJECT,
        actingAs: 'REPRESENTATIVE',
        representativeScope: 'PREPARE_SUBMIT',
        discoverySnapshotId: SNAPSHOT,
        ruleId: RULE,
        ruleVersion: 2,
        workflowVersion: 4,
      });
    });

    it('404s for a project outside the enterprise, without touching discovery', async () => {
      const { service, prisma } = build({ project: null });
      const e = await thrown(
        service.create(ownerAccess, PROJECT, ACTOR, createDto(), 'ip'),
      );
      expect(e).toBeInstanceOf(NotFoundException);
      expect(prisma.discoverySnapshot.findFirst).not.toHaveBeenCalled();
    });

    it('404s for a snapshot that is not this project’s', async () => {
      const { service } = build({ snapshot: null });
      const e = await thrown(
        service.create(ownerAccess, PROJECT, ACTOR, createDto(), 'ip'),
      );
      expect(e).toBeInstanceOf(NotFoundException);
      expect(e.getResponse().message).toBe('Discovery result not found.');
    });

    it('422s when the approval was not applicable in the cited discovery result', async () => {
      const { service } = build({
        snapshot: {
          ...snapshotRow,
          result: { applicable: [], notApplicable: [] },
        },
      });
      const e = await thrown(
        service.create(ownerAccess, PROJECT, ACTOR, createDto(), 'ip'),
      );
      expect(e).toBeInstanceOf(UnprocessableEntityException);
      expect(e.getResponse().code).toBe(ErrorCodes.APPROVAL_NOT_IN_DISCOVERY);
    });

    it('422s (rather than crashing) on a malformed stored result', async () => {
      const { service } = build({
        snapshot: { ...snapshotRow, result: null },
      });
      const e = await thrown(
        service.create(ownerAccess, PROJECT, ACTOR, createDto(), 'ip'),
      );
      expect(e.getResponse().code).toBe(ErrorCodes.APPROVAL_NOT_IN_DISCOVERY);
    });

    it('409s when the approval type has been deactivated since discovery', async () => {
      const { service } = build({
        approvalType: { id: TYPE, isActive: false },
      });
      const e = await thrown(
        service.create(ownerAccess, PROJECT, ACTOR, createDto(), 'ip'),
      );
      expect(e).toBeInstanceOf(ConflictException);
      expect(e.getResponse().code).toBe(ErrorCodes.APPROVAL_TYPE_INACTIVE);
    });

    it('409s when no active workflow is configured (nothing is invented)', async () => {
      const { service, tx } = build({ workflow: null });
      const e = await thrown(
        service.create(ownerAccess, PROJECT, ACTOR, createDto(), 'ip'),
      );
      expect(e.getResponse().code).toBe(ErrorCodes.WORKFLOW_NOT_CONFIGURED);
      expect(tx.approvalApplication.create).not.toHaveBeenCalled();
    });

    it('picks the highest active workflow version', async () => {
      const { service, prisma } = build();
      await service.create(ownerAccess, PROJECT, ACTOR, createDto(), 'ip');
      expect(prisma.workflow.findFirst).toHaveBeenCalledWith({
        where: { approvalTypeId: TYPE, isActive: true },
        orderBy: { version: 'desc' },
      });
    });

    it('409s when a live application for the same approval already exists, under an advisory lock', async () => {
      const { service, tx, audit } = build({ existingLive: { id: APP } });
      const e = await thrown(
        service.create(ownerAccess, PROJECT, ACTOR, createDto(), 'ip'),
      );
      expect(e).toBeInstanceOf(ConflictException);
      expect(e.getResponse().code).toBe(ErrorCodes.APPLICATION_ALREADY_EXISTS);
      expect(tx.$executeRaw).toHaveBeenCalledTimes(1);
      expect(tx.approvalApplication.create).not.toHaveBeenCalled();
      expect(audit.record).not.toHaveBeenCalled();
    });

    it('400s on malformed formData before any lookup', async () => {
      const { service, prisma } = build();
      const e = await thrown(
        service.create(
          ownerAccess,
          PROJECT,
          ACTOR,
          createDto({ formData: { enterpriseId: 'x', nested: { a: 1 } } }),
          'ip',
        ),
      );
      expect(e).toBeInstanceOf(BadRequestException);
      expect(Object.keys(e.getResponse().fields)).toEqual([
        'formData.enterpriseId',
        'formData.nested',
      ]);
      expect(prisma.project.findFirst).not.toHaveBeenCalled();
    });
  });

  // -----------------------------------------------------------------------
  describe('read', () => {
    it('finds an application by id AND project AND the authorised enterprise', async () => {
      const { service, prisma } = build();
      await service.get(ownerAccess, PROJECT, APP);
      expect(
        prisma.approvalApplication.findFirst.mock.calls[0][0].where,
      ).toEqual({
        id: APP,
        projectId: PROJECT,
        project: { enterpriseId: ENTERPRISE },
      });
    });

    it('404s for an application that is not there (any enterprise/project mismatch looks the same)', async () => {
      const { service } = build({ application: null });
      const e = await thrown(service.get(ownerAccess, PROJECT, APP));
      expect(e).toBeInstanceOf(NotFoundException);
    });

    it('exposes the applicant-facing status only, never the internal state', async () => {
      const { service } = build();
      const res = await service.get(ownerAccess, PROJECT, APP);
      expect(res).not.toHaveProperty('internalState');
      expect(res.applicantStatus).toBe('READY_TO_SUBMIT');
      expect(res.editable).toBe(true);
      expect(res.enterpriseId).toBe(ENTERPRISE);
    });

    it('reports a submitted application as not editable', async () => {
      const { service } = build({
        application: applicationRow({
          internalState: 'SUBMITTED',
          applicantStatus: 'SUBMITTED',
          referenceNumber: 'APP-2026-000001',
          submittedAt: new Date(),
        }),
      });
      const status = await service.getStatus(ownerAccess, PROJECT, APP);
      expect(status).toMatchObject({
        applicantStatus: 'SUBMITTED',
        editable: false,
        referenceNumber: 'APP-2026-000001',
      });
    });

    it('lists a project’s applications after checking the project is in the enterprise', async () => {
      const { service, prisma } = build();
      await service.listForProject(ownerAccess, PROJECT, {});
      expect(prisma.project.findFirst).toHaveBeenCalledWith({
        where: { id: PROJECT, enterpriseId: ENTERPRISE },
      });
      expect(
        prisma.approvalApplication.findMany.mock.calls[0][0].where,
      ).toEqual({
        projectId: PROJECT,
      });
    });

    it('applies the optional filters', async () => {
      const { service, prisma } = build();
      await service.listForProject(ownerAccess, PROJECT, {
        approvalTypeId: TYPE,
        applicantStatus: 'DRAFT',
      });
      expect(
        prisma.approvalApplication.findMany.mock.calls[0][0].where,
      ).toEqual({
        projectId: PROJECT,
        approvalTypeId: TYPE,
        applicantStatus: 'DRAFT',
      });
    });

    it('lists enterprise-wide for an unrestricted caller, scoped to the enterprise', async () => {
      const { service, prisma } = build();
      await service.listForEnterprise(repAccess(), {});
      expect(
        prisma.approvalApplication.findMany.mock.calls[0][0].where,
      ).toEqual({
        project: { enterpriseId: ENTERPRISE },
      });
    });

    it('limits a project-restricted representative to their projects', async () => {
      const { service, prisma } = build();
      await service.listForEnterprise(repAccess([PROJECT]), {});
      expect(
        prisma.approvalApplication.findMany.mock.calls[0][0].where,
      ).toEqual({
        project: { enterpriseId: ENTERPRISE },
        projectId: { in: [PROJECT] },
      });
    });

    it('returns nothing (no query) when a restricted representative filters to a project outside their list', async () => {
      const { service, prisma } = build();
      const res = await service.listForEnterprise(repAccess([PROJECT]), {
        projectId: OTHER_PROJECT,
      });
      expect(res).toEqual([]);
      expect(prisma.approvalApplication.findMany).not.toHaveBeenCalled();
    });

    it('allows a restricted representative to filter to a project inside their list', async () => {
      const { service, prisma } = build();
      await service.listForEnterprise(repAccess([PROJECT]), {
        projectId: PROJECT,
      });
      expect(
        prisma.approvalApplication.findMany.mock.calls[0][0].where,
      ).toEqual({
        project: { enterpriseId: ENTERPRISE },
        projectId: PROJECT,
      });
    });
  });

  // -----------------------------------------------------------------------
  describe('updateDraft', () => {
    it('replaces the details atomically, only while still a draft, and audits the diff', async () => {
      const { service, prisma, audit } = build();
      await service.updateDraft(
        repAccess(),
        PROJECT,
        APP,
        ACTOR,
        { formData: { a: 'new', b: 2 } },
        'ip',
      );
      expect(prisma.approvalApplication.updateMany).toHaveBeenCalledWith({
        where: { id: APP, internalState: 'DRAFT' },
        data: {
          formData: { a: 'new', b: 2 },
          applicantStatus: 'READY_TO_SUBMIT',
        },
      });
      const event = audit.record.mock.calls[0][0];
      expect(event.action).toBe(AuditActions.APPLICATION_UPDATED);
      expect(event.beforeState).toMatchObject({
        formData: { a: 'old', b: null },
      });
      expect(event.afterState).toMatchObject({
        formData: { a: 'new', b: 2 },
        actingAs: 'REPRESENTATIVE',
        enterpriseId: ENTERPRISE,
        projectId: PROJECT,
      });
      expect(event.ruleVersionUsed).toBe(`${RULE}@v2`);
    });

    it('is a no-op (no write, no audit) when nothing changed', async () => {
      const { service, prisma, audit } = build();
      await service.updateDraft(
        ownerAccess,
        PROJECT,
        APP,
        ACTOR,
        { formData: { a: 'old' } },
        'ip',
      );
      expect(prisma.approvalApplication.updateMany).not.toHaveBeenCalled();
      expect(audit.record).not.toHaveBeenCalled();
    });

    it('refuses to edit a submitted application (ALREADY_SUBMITTED) without writing', async () => {
      const { service, prisma, audit } = build({
        application: applicationRow({ internalState: 'SUBMITTED' }),
      });
      const e = await thrown(
        service.updateDraft(
          ownerAccess,
          PROJECT,
          APP,
          ACTOR,
          { formData: {} },
          'ip',
        ),
      );
      expect(e).toBeInstanceOf(ConflictException);
      expect(e.getResponse().code).toBe(ErrorCodes.ALREADY_SUBMITTED);
      expect(prisma.approvalApplication.updateMany).not.toHaveBeenCalled();
      expect(audit.record).not.toHaveBeenCalled();
    });

    it('refuses when a submission won the race (guarded update matched nothing)', async () => {
      const { service, audit } = build({ updateCount: 0 });
      const e = await thrown(
        service.updateDraft(
          ownerAccess,
          PROJECT,
          APP,
          ACTOR,
          { formData: { a: 'new' } },
          'ip',
        ),
      );
      expect(e.getResponse().code).toBe(ErrorCodes.ALREADY_SUBMITTED);
      expect(audit.record).not.toHaveBeenCalled();
    });

    it('rejects invalid details with field errors and does not write', async () => {
      const { service, prisma } = build();
      const e = await thrown(
        service.updateDraft(
          ownerAccess,
          PROJECT,
          APP,
          ACTOR,
          { formData: { status: 'APPROVED' } },
          'ip',
        ),
      );
      expect(e).toBeInstanceOf(BadRequestException);
      expect(Object.keys(e.getResponse().fields)).toEqual(['formData.status']);
      expect(prisma.approvalApplication.updateMany).not.toHaveBeenCalled();
    });
  });

  // -----------------------------------------------------------------------
  describe('preValidate', () => {
    it('returns the summary with the mandatory disclaimer and writes nothing', async () => {
      const { service, prisma, audit } = build();
      const summary = await service.preValidate(ownerAccess, PROJECT, APP);
      expect(summary.readyForSubmission).toBe(true);
      expect(summary.disclaimer).toMatch(/does not guarantee approval/);
      expect(prisma.approvalApplication.updateMany).not.toHaveBeenCalled();
      expect(audit.record).not.toHaveBeenCalled();
    });

    it('reports missing mandatory documents', async () => {
      const { service } = build({
        mandatory: [
          { id: 'r1', name: 'Identity proof' },
          { id: 'r2', name: 'Site plan' },
        ],
        linkedRequirementIds: ['r2'],
      });
      const summary = await service.preValidate(ownerAccess, PROJECT, APP);
      expect(summary.readyForSubmission).toBe(false);
      expect(summary.missingDocuments).toEqual([
        { requirementId: 'r1', name: 'Identity proof' },
      ]);
    });

    it('refuses a non-draft with ALREADY_SUBMITTED', async () => {
      const { service } = build({
        application: applicationRow({ internalState: 'SUBMITTED' }),
      });
      const e = await thrown(service.preValidate(ownerAccess, PROJECT, APP));
      expect(e.getResponse().code).toBe(ErrorCodes.ALREADY_SUBMITTED);
    });

    it('asks only for CURRENT, scanned, usable, unexpired documents when checking a requirement', async () => {
      const { service, prisma } = build({
        mandatory: [{ id: 'r1', name: 'Identity proof' }],
      });
      await service.preValidate(ownerAccess, PROJECT, APP);
      const satisfiedQuery = prisma.applicationDocument.findMany.mock.calls
        .map((c: any[]) => c[0])
        .find((a: any) => a.where.document.documentRequirementId);
      expect(satisfiedQuery.where.document).toMatchObject({
        replacements: { none: {} },
        documentRequirementId: { in: ['r1'] },
        status: { in: ['VALIDATION_PENDING', 'VERIFIED'] },
        scannedAt: { not: null },
      });
      expect(satisfiedQuery.where.document.OR).toEqual([
        { expiryDate: null },
        { expiryDate: { gt: expect.any(Date) } },
      ]);
    });

    it('blocks on a current document that is expired or rejected (Replacement Required)', async () => {
      const { service } = build({
        documentIssueRows: [
          { id: 'd-old', originalFilename: 'lease.pdf', status: 'EXPIRED' },
          { id: 'd-bad', originalFilename: 'id.pdf', status: 'REJECTED' },
        ],
      });
      const summary = await service.preValidate(ownerAccess, PROJECT, APP);
      expect(summary.readyForSubmission).toBe(false);
      expect(summary.errors.map((e) => e.code).sort()).toEqual([
        'DOCUMENT_EXPIRED',
        'DOCUMENT_REJECTED',
      ]);
      expect(summary.errors.map((e) => e.message).join(' ')).toContain(
        'lease.pdf',
      );
    });
  });

  // -----------------------------------------------------------------------
  describe('submit', () => {
    it('performs the explicit DRAFT -> SUBMITTED transition, atomically and optimistically', async () => {
      const { service, prisma } = build();
      const row = applicationRow();
      await service.submit(ownerAccess, PROJECT, APP, ACTOR, submitDto, 'ip');

      const call = prisma.approvalApplication.updateMany.mock.calls[0][0];
      expect(call.where).toEqual({
        id: APP,
        internalState: 'DRAFT',
        updatedAt: row.updatedAt,
      });
      expect(call.data).toMatchObject({
        internalState: 'SUBMITTED',
        applicantStatus: 'SUBMITTED',
        submittedByUserId: ACTOR,
        referenceNumber: 'APP-2026-000042',
      });
      expect(call.data.submittedAt).toBeInstanceOf(Date);
      expect(call.data.declarationAcceptedAt).toBeInstanceOf(Date);
    });

    it('audits the status change and the submission, both carrying the rule version and snapshot', async () => {
      const { service, audit } = build();
      await service.submit(
        repAccess(),
        PROJECT,
        APP,
        ACTOR,
        submitDto,
        '5.5.5.5',
      );

      const events = audit.record.mock.calls.map((c) => c[0]);
      expect(events.map((e) => e.action)).toEqual([
        AuditActions.APPLICATION_STATUS_CHANGED,
        AuditActions.APPLICATION_SUBMITTED,
      ]);
      expect(events[0].beforeState).toMatchObject({
        internalState: 'DRAFT',
        applicantStatus: 'READY_TO_SUBMIT',
      });
      expect(events[0].afterState).toMatchObject({
        internalState: 'SUBMITTED',
        applicantStatus: 'SUBMITTED',
        action: 'SUBMIT',
        actingAs: 'REPRESENTATIVE',
      });
      expect(events[1].afterState).toMatchObject({
        referenceNumber: 'APP-2026-000042',
        discoverySnapshotId: SNAPSHOT,
        ruleId: RULE,
        ruleVersion: 2,
        enterpriseId: ENTERPRISE,
        projectId: PROJECT,
        declarationAccepted: true,
      });
      for (const e of events) {
        expect(e.userId).toBe(ACTOR);
        expect(e.ipAddress).toBe('5.5.5.5');
        expect(e.ruleVersionUsed).toBe(`${RULE}@v2`);
      }
    });

    it('freezes the current document versions onto the application at submission', async () => {
      const { service, prisma, audit } = build({
        snapshotDocuments: [
          {
            id: 'doc-2',
            version: 2,
            lineageId: 'lin-1',
            documentRequirementId: 'req-1',
            originalFilename: 'second.pdf',
            mimeType: 'application/pdf',
            sizeBytes: 10,
            checksum: 'abc',
            status: 'VALIDATION_PENDING',
            scannedAt: new Date('2026-09-19T10:00:00.000Z'),
            scannerName: 'DEV_MOCK_EICAR',
            expiryDate: null,
            createdAt: new Date('2026-09-19T09:00:00.000Z'),
          },
        ],
      });
      await service.submit(ownerAccess, PROJECT, APP, ACTOR, submitDto, 'ip');

      const data = prisma.approvalApplication.updateMany.mock.calls[0][0].data;
      expect(data.submittedDocuments).toEqual([
        {
          documentId: 'doc-2',
          version: 2,
          lineageId: 'lin-1',
          requirementId: 'req-1',
          originalFilename: 'second.pdf',
          mimeType: 'application/pdf',
          sizeBytes: 10,
          checksum: 'abc',
          status: 'VALIDATION_PENDING',
          scannedAt: '2026-09-19T10:00:00.000Z',
          scannerName: 'DEV_MOCK_EICAR',
          expiryDate: null,
          uploadedAt: '2026-09-19T09:00:00.000Z',
        },
      ]);
      const snapshotQuery = prisma.applicationDocument.findMany.mock.calls
        .map((c: any[]) => c[0])
        .find((a: any) => a.select?.document === true);
      expect(snapshotQuery.where.document).toEqual({
        replacements: { none: {} },
      });

      const submitted = audit.record.mock.calls
        .map((c: any[]) => c[0])
        .find((e: any) => e.action === AuditActions.APPLICATION_SUBMITTED);
      expect(submitted.afterState.documents).toEqual([
        { documentId: 'doc-2', version: 2, requirementId: 'req-1' },
      ]);
    });

    it('records an empty document snapshot when no document was attached', async () => {
      const { service, prisma } = build();
      await service.submit(ownerAccess, PROJECT, APP, ACTOR, submitDto, 'ip');
      expect(
        prisma.approvalApplication.updateMany.mock.calls[0][0].data
          .submittedDocuments,
      ).toEqual([]);
    });

    it('does not submit when a current document is expired', async () => {
      const { service, prisma } = build({
        documentIssueRows: [
          { id: 'd1', originalFilename: 'lease.pdf', status: 'EXPIRED' },
        ],
      });
      const e = await thrown(
        service.submit(ownerAccess, PROJECT, APP, ACTOR, submitDto, 'ip'),
      );
      expect(e.getResponse().code).toBe(ErrorCodes.VALIDATION_FAILED);
      expect(e.getResponse().fields.documents[0]).toContain('lease.pdf');
      expect(prisma.approvalApplication.updateMany).not.toHaveBeenCalled();
    });

    it.each(['SUBMITTED', 'UNDER_SCRUTINY', 'APPROVED'])(
      'refuses to submit from %s (already submitted) without writing',
      async (state) => {
        const { service, prisma, audit } = build({
          application: applicationRow({
            internalState: state,
            submittedAt: new Date(),
          }),
        });
        const e = await thrown(
          service.submit(ownerAccess, PROJECT, APP, ACTOR, submitDto, 'ip'),
        );
        expect(e.getResponse().code).toBe(ErrorCodes.ALREADY_SUBMITTED);
        expect(prisma.approvalApplication.updateMany).not.toHaveBeenCalled();
        expect(prisma.$queryRaw).not.toHaveBeenCalled();
        expect(audit.record).not.toHaveBeenCalled();
      },
    );

    it('reports an undefined transition for a never-submitted non-draft (e.g. cancelled)', async () => {
      const { service } = build({
        application: applicationRow({ internalState: 'CANCELLED' }),
      });
      const e = await thrown(
        service.submit(ownerAccess, PROJECT, APP, ACTOR, submitDto, 'ip'),
      );
      expect(e.getResponse().code).toBe(ErrorCodes.INVALID_STATE_TRANSITION);
    });

    it('blocks submission with VALIDATION_FAILED when a mandatory document is missing', async () => {
      const { service, prisma, audit } = build({
        mandatory: [{ id: 'r1', name: 'Identity proof' }],
      });
      const e = await thrown(
        service.submit(ownerAccess, PROJECT, APP, ACTOR, submitDto, 'ip'),
      );
      expect(e).toBeInstanceOf(UnprocessableEntityException);
      expect(e.getResponse().code).toBe(ErrorCodes.VALIDATION_FAILED);
      expect(e.getResponse().fields.documents).toEqual([
        'Missing mandatory document: Identity proof',
      ]);
      expect(prisma.$queryRaw).not.toHaveBeenCalled();
      expect(prisma.approvalApplication.updateMany).not.toHaveBeenCalled();
      expect(audit.record).not.toHaveBeenCalled();
    });

    it('blocks submission when the approval type has been deactivated', async () => {
      const row = applicationRow();
      (row.approvalType as { isActive: boolean }).isActive = false;
      const { service } = build({ application: row });
      const e = await thrown(
        service.submit(ownerAccess, PROJECT, APP, ACTOR, submitDto, 'ip'),
      );
      expect(e.getResponse().code).toBe(ErrorCodes.VALIDATION_FAILED);
      expect(e.getResponse().fields).toHaveProperty('APPROVAL_TYPE_INACTIVE');
    });

    it('reports CONFLICT when the draft changed while submitting, and ALREADY_SUBMITTED when it was submitted', async () => {
      const first = build({ updateCount: 0 });
      const conflict = await thrown(
        first.service.submit(ownerAccess, PROJECT, APP, ACTOR, submitDto, 'ip'),
      );
      expect(conflict.getResponse().code).toBe(ErrorCodes.CONFLICT);
      expect(first.audit.record).not.toHaveBeenCalled();

      const second = build({ updateCount: 0 });
      second.prisma.approvalApplication.findFirst
        .mockResolvedValueOnce(applicationRow())
        .mockResolvedValueOnce(applicationRow({ internalState: 'SUBMITTED' }));
      const already = await thrown(
        second.service.submit(
          ownerAccess,
          PROJECT,
          APP,
          ACTOR,
          submitDto,
          'ip',
        ),
      );
      expect(already.getResponse().code).toBe(ErrorCodes.ALREADY_SUBMITTED);
    });

    it('never accepts a status from the caller: the target state comes only from the transition table', async () => {
      const { service, prisma } = build();
      await service.submit(
        ownerAccess,
        PROJECT,
        APP,
        ACTOR,
        { declarationAccepted: true, internalState: 'APPROVED' } as never,
        'ip',
      );
      expect(
        prisma.approvalApplication.updateMany.mock.calls[0][0].data
          .internalState,
      ).toBe('SUBMITTED');
    });
  });

  // -----------------------------------------------------------------------
  describe('syncDraftStatus (called by the document module)', () => {
    const withTx = (
      row: Record<string, unknown> | null,
      extra: Parameters<typeof build>[0] = {},
    ) => {
      const built = build(extra);
      const db = {
        approvalApplication: {
          findUnique: jest.fn().mockResolvedValue(row),
          updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        },
        documentRequirement: built.prisma.documentRequirement,
        applicationDocument: built.prisma.applicationDocument,
      };
      return { ...built, db };
    };

    it('re-derives Ready to Submit and bumps updated_at, guarded to drafts', async () => {
      const { service, db } = withTx(
        applicationRow({ applicantStatus: 'DRAFT' }),
      );
      await service.syncDraftStatus(db as never, APP);
      expect(db.approvalApplication.updateMany).toHaveBeenCalledWith({
        where: { id: APP, internalState: 'DRAFT' },
        data: {
          applicantStatus: 'READY_TO_SUBMIT',
          updatedAt: expect.any(Date),
        },
      });
    });

    it('derives Draft while a mandatory document is still missing', async () => {
      const { service, db } = withTx(applicationRow(), {
        mandatory: [{ id: 'r1', name: 'Identity proof' }],
      });
      await service.syncDraftStatus(db as never, APP);
      expect(
        db.approvalApplication.updateMany.mock.calls[0][0].data.applicantStatus,
      ).toBe('DRAFT');
    });

    it('does nothing for a submitted application or a missing one', async () => {
      const submitted = withTx(applicationRow({ internalState: 'SUBMITTED' }));
      await submitted.service.syncDraftStatus(submitted.db as never, APP);
      expect(
        submitted.db.approvalApplication.updateMany,
      ).not.toHaveBeenCalled();
      const missing = withTx(null);
      await missing.service.syncDraftStatus(missing.db as never, APP);
      expect(missing.db.approvalApplication.updateMany).not.toHaveBeenCalled();
    });

    it('writes only through the client it was given (its own transaction)', async () => {
      const { service, db, prisma } = withTx(applicationRow());
      await service.syncDraftStatus(db as never, APP);
      expect(db.approvalApplication.updateMany).toHaveBeenCalledTimes(1);
      expect(prisma.approvalApplication.updateMany).not.toHaveBeenCalled();
    });
  });
});

describe('ApplicationsService.submit: notifying the applicant side (FRD 26.1)', () => {
  it('raises APPLICATION_SUBMITTED once, after the commit and the audit, keyed by the application only', async () => {
    const { service, audit, notifications } = build();
    await service.submit(ownerAccess, PROJECT, APP, ACTOR, submitDto, 'ip');
    expect(notifications.applicationSubmitted).toHaveBeenCalledTimes(1);
    expect(notifications.applicationSubmitted).toHaveBeenCalledWith(APP);
    const lastAudit = Math.max(...audit.record.mock.invocationCallOrder);
    expect(lastAudit).toBeLessThan(
      notifications.applicationSubmitted.mock.invocationCallOrder[0],
    );
  });

  it('notifies nobody when the submission is refused', async () => {
    const { service, notifications } = build({
      application: applicationRow({
        internalState: 'SUBMITTED',
        submittedAt: new Date(),
      }),
    });
    await expect(
      service.submit(ownerAccess, PROJECT, APP, ACTOR, submitDto, 'ip'),
    ).rejects.toBeDefined();
    expect(notifications.applicationSubmitted).not.toHaveBeenCalled();
  });
});
