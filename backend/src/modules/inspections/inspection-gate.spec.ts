import {
  InspectionFacts,
  RECOMMENDATION_BLOCK_MESSAGES,
  inspectionRequired,
  loadInspectionFacts,
  loadInspectionsWithOutcome,
  recommendationBlock,
} from './inspection-gate';

const facts = (over: Partial<InspectionFacts> = {}): InspectionFacts => ({
  required: false,
  open: 0,
  completed: 0,
  ...over,
});

describe('recommendationBlock (TRD 3.3: inspection before recommendation)', () => {
  it('does not stand in the way when no inspection is required and none exists', () => {
    expect(recommendationBlock(facts())).toBeNull();
  });

  it('blocks a required inspection that has not been completed', () => {
    expect(recommendationBlock(facts({ required: true }))).toBe(
      'INSPECTION_REQUIRED',
    );
  });

  it('is satisfied by a completed inspection', () => {
    expect(recommendationBlock(facts({ required: true, completed: 1 }))).toBe(
      null,
    );
    expect(recommendationBlock(facts({ required: true, completed: 3 }))).toBe(
      null,
    );
  });

  it('blocks while an inspection is open, whether or not the workflow required it', () => {
    expect(recommendationBlock(facts({ open: 1 }))).toBe('INSPECTION_OPEN');
    expect(recommendationBlock(facts({ required: true, open: 1 }))).toBe(
      'INSPECTION_OPEN',
    );
  });

  it('keeps blocking a further, open inspection even after an earlier one was completed', () => {
    expect(
      recommendationBlock(facts({ required: true, completed: 1, open: 1 })),
    ).toBe('INSPECTION_OPEN');
  });

  it('an optional inspection that was requested and completed changes nothing else', () => {
    expect(recommendationBlock(facts({ completed: 1 }))).toBeNull();
  });

  it('has a message for every reason', () => {
    expect(Object.keys(RECOMMENDATION_BLOCK_MESSAGES).sort()).toEqual([
      'INSPECTION_OPEN',
      'INSPECTION_REQUIRED',
    ]);
  });
});

describe('inspectionRequired (TRD 10.1: driven by the workflow definition)', () => {
  const dbWith = (stages: Array<{ id: string }> | null) => ({
    approvalApplication: {
      findUnique: jest
        .fn()
        .mockResolvedValue(stages === null ? null : { workflow: { stages } }),
    },
  });

  it('is true when the pinned workflow has an INSPECTION stage, and only asks for those', async () => {
    const db = dbWith([{ id: 's1' }]);
    await expect(inspectionRequired(db as never, 'app')).resolves.toBe(true);
    expect(db.approvalApplication.findUnique).toHaveBeenCalledWith({
      where: { id: 'app' },
      select: {
        workflow: {
          select: {
            stages: {
              where: { stageType: 'INSPECTION' },
              select: { id: true },
            },
          },
        },
      },
    });
  });

  it('is false when the workflow has no INSPECTION stage, or the application is unknown', async () => {
    await expect(inspectionRequired(dbWith([]) as never, 'a')).resolves.toBe(
      false,
    );
    await expect(inspectionRequired(dbWith(null) as never, 'a')).resolves.toBe(
      false,
    );
  });
});

describe('loadInspectionFacts', () => {
  it('counts open (PENDING + SCHEDULED) and completed inspections; cancelled ones count for nothing', async () => {
    const db = {
      approvalApplication: {
        findUnique: jest
          .fn()
          .mockResolvedValue({ workflow: { stages: [{ id: 's' }] } }),
      },
      inspection: {
        groupBy: jest.fn().mockResolvedValue([
          { status: 'PENDING', _count: { _all: 1 } },
          { status: 'SCHEDULED', _count: { _all: 2 } },
          { status: 'COMPLETED', _count: { _all: 4 } },
          { status: 'CANCELLED', _count: { _all: 8 } },
        ]),
      },
    };
    await expect(loadInspectionFacts(db as never, 'app')).resolves.toEqual({
      required: true,
      open: 3,
      completed: 4,
    });
  });

  it('is all-zero for an application with no inspections and no requirement', async () => {
    const db = {
      approvalApplication: {
        findUnique: jest.fn().mockResolvedValue({ workflow: { stages: [] } }),
      },
      inspection: { groupBy: jest.fn().mockResolvedValue([]) },
    };
    await expect(loadInspectionFacts(db as never, 'app')).resolves.toEqual({
      required: false,
      open: 0,
      completed: 0,
    });
  });
});

describe('loadInspectionsWithOutcome', () => {
  it('reads every inspection of the application, oldest first, regardless of inspector', async () => {
    const findMany = jest.fn().mockResolvedValue([]);
    await loadInspectionsWithOutcome(
      { inspection: { findMany } } as never,
      'a',
    );
    const args = findMany.mock.calls[0][0];
    expect(args.where).toEqual({ applicationId: 'a' });
    expect(args.orderBy).toEqual([{ createdAt: 'asc' }, { id: 'asc' }]);
    // Selects the report, never the inspector or assignment data.
    expect(args.select.inspectorId).toBeUndefined();
    expect(args.select.reportSummary).toBeDefined();
  });
});
