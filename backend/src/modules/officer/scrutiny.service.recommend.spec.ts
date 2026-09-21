import { ConflictException } from '@nestjs/common';
import { ScrutinyService } from './scrutiny.service';
import { findScrutinyTransition } from './scrutiny-state.machine';

const APP = '33333333-3333-4333-8333-333333333333';
const USER = '00000000-0000-4000-8000-0000000000b2';

/** A tx whose inspection facts are set per test; everything is read through
 * the transaction handed to `support.run`, never the bare prisma client. */
function build(facts: { stages: number; groups: Array<[string, number]> }) {
  const tx = {
    approvalApplication: {
      findUnique: jest.fn().mockResolvedValue({
        workflow: {
          stages: Array.from({ length: facts.stages }, (_, i) => ({
            id: `s${i}`,
          })),
        },
      }),
    },
    inspection: {
      groupBy: jest
        .fn()
        .mockResolvedValue(
          facts.groups.map(([status, n]) => ({ status, _count: { _all: n } })),
        ),
    },
    scrutinyRecommendation: {
      create: jest.fn().mockResolvedValue({
        id: 'rec',
        outcome: 'APPROVE',
        reason: 'ok',
        recommendedByUserId: USER,
        createdAt: new Date(),
      }),
    },
  };
  const support = {
    run: jest.fn((_ctx: unknown, fn: (tx: unknown, l: unknown) => unknown) =>
      fn(tx, { internalState: 'UNDER_SCRUTINY' }),
    ),
    transitionFor: jest.fn(() =>
      findScrutinyTransition('RECOMMEND', 'UNDER_SCRUTINY'),
    ),
    apply: jest.fn().mockResolvedValue(undefined),
    recordOfficerEvent: jest.fn().mockResolvedValue(undefined),
    recordStatusChange: jest.fn().mockResolvedValue(undefined),
    contextOf: jest.fn().mockReturnValue({}),
    ruleVersionOf: jest.fn().mockReturnValue(null),
  };
  const sla = {
    completeScrutiny: jest.fn().mockResolvedValue([]),
    record: jest.fn().mockResolvedValue(undefined),
  };
  const access = {
    resolveApplication: jest.fn().mockResolvedValue({ app: { id: APP } }),
  };
  const service = new ScrutinyService(
    {} as never,
    {} as never,
    access as never,
    support as never,
    {} as never,
    sla as never,
  );
  return { service, tx, support, sla };
}

const recommend = (service: ScrutinyService) =>
  service.recommend(
    USER,
    APP,
    { outcome: 'APPROVE', reason: 'ok' } as never,
    'ip',
  );

describe('ScrutinyService.recommend — inspection before recommendation (TRD 3.3)', () => {
  it('records the recommendation and moves the state when no inspection is in the way', async () => {
    const { service, tx, support } = build({ stages: 0, groups: [] });
    await recommend(service);
    expect(tx.scrutinyRecommendation.create).toHaveBeenCalledTimes(1);
    expect(support.apply).toHaveBeenCalledTimes(1);
  });

  it('is refused with INSPECTION_REQUIRED when the workflow requires one and none is completed — and writes nothing', async () => {
    const { service, tx, support } = build({ stages: 1, groups: [] });
    const error = await recommend(service).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ConflictException);
    expect((error as ConflictException).getResponse()).toMatchObject({
      code: 'INSPECTION_REQUIRED',
    });
    expect(tx.scrutinyRecommendation.create).not.toHaveBeenCalled();
    expect(support.apply).not.toHaveBeenCalled();
    expect(support.recordOfficerEvent).not.toHaveBeenCalled();
  });

  it('is refused with INSPECTION_OPEN while an inspection is pending or scheduled', async () => {
    for (const status of ['PENDING', 'SCHEDULED']) {
      const { service, tx } = build({ stages: 0, groups: [[status, 1]] });
      const error = await recommend(service).catch((e: unknown) => e);
      expect((error as ConflictException).getResponse()).toMatchObject({
        code: 'INSPECTION_OPEN',
      });
      expect(tx.scrutinyRecommendation.create).not.toHaveBeenCalled();
    }
  });

  it('is allowed once a required inspection is completed, whatever its outcome', async () => {
    const { service, tx } = build({ stages: 1, groups: [['COMPLETED', 1]] });
    await recommend(service);
    expect(tx.scrutinyRecommendation.create).toHaveBeenCalledTimes(1);
  });

  it('checks the state machine first, then reads the inspection facts inside the same locked transaction', async () => {
    const { service, tx, support } = build({ stages: 1, groups: [] });
    await recommend(service).catch(() => undefined);
    expect(support.run).toHaveBeenCalledTimes(1);
    expect(support.transitionFor).toHaveBeenCalledWith(
      'RECOMMEND',
      'UNDER_SCRUTINY',
    );
    expect(tx.inspection.groupBy).toHaveBeenCalledTimes(1);
  });
});
