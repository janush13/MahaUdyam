import { AuditActions } from '../../infrastructure/audit/audit-actions.constant';
import { planChange, statusFor } from './inspection-rules';

const T1 = new Date('2026-10-01T05:00:00Z');
const T2 = new Date('2026-10-02T05:00:00Z');

const current = (over: Partial<Parameters<typeof planChange>[0]> = {}) => ({
  inspectorId: 'insp-1',
  scheduledAt: null as Date | null,
  siteAddress: 'Plot 4, MIDC',
  ...over,
});

describe('inspection rules', () => {
  describe('statusFor (status is derived, never chosen)', () => {
    it('is PENDING without a schedule and SCHEDULED with one', () => {
      expect(statusFor(null)).toBe('PENDING');
      expect(statusFor(T1)).toBe('SCHEDULED');
    });

    it('never produces a finished or cancelled inspection (Step 11B)', () => {
      for (const at of [null, T1]) {
        expect(['COMPLETED', 'CANCELLED']).not.toContain(statusFor(at));
      }
    });
  });

  describe('planChange', () => {
    it('treats identical values as no change at all', () => {
      const plan = planChange(current({ scheduledAt: T1 }), {
        inspectorUserId: 'insp-1',
        scheduledAt: new Date(T1),
        siteAddress: 'Plot 4, MIDC',
      });
      expect(plan).toEqual({ data: {}, events: [] });
    });

    it('a different inspector is a reassignment and nothing else', () => {
      const plan = planChange(current(), { inspectorUserId: 'insp-2' });
      expect(plan.data).toEqual({ inspectorId: 'insp-2' });
      expect(plan.events).toEqual([AuditActions.INSPECTION_REASSIGNED]);
    });

    it('a first schedule makes a PENDING inspection SCHEDULED', () => {
      const plan = planChange(current(), { scheduledAt: T1 });
      expect(plan.data).toEqual({ scheduledAt: T1, status: 'SCHEDULED' });
      expect(plan.events).toEqual([AuditActions.INSPECTION_SCHEDULED]);
    });

    it('moving an existing schedule is a reschedule and does not re-set the status', () => {
      const plan = planChange(current({ scheduledAt: T1 }), {
        scheduledAt: T2,
      });
      expect(plan.data).toEqual({ scheduledAt: T2 });
      expect(plan.events).toEqual([AuditActions.INSPECTION_RESCHEDULED]);
    });

    it('a different site is a site update', () => {
      const plan = planChange(current(), { siteAddress: 'Plot 9, MIDC' });
      expect(plan.data).toEqual({ siteAddress: 'Plot 9, MIDC' });
      expect(plan.events).toEqual([AuditActions.INSPECTION_SITE_UPDATED]);
    });

    it('several changes yield one event each, in a fixed order', () => {
      const plan = planChange(current(), {
        inspectorUserId: 'insp-2',
        scheduledAt: T1,
        siteAddress: 'Plot 9, MIDC',
      });
      expect(plan.events).toEqual([
        AuditActions.INSPECTION_REASSIGNED,
        AuditActions.INSPECTION_SCHEDULED,
        AuditActions.INSPECTION_SITE_UPDATED,
      ]);
    });

    it('can never un-schedule: there is no way to express a null schedule', () => {
      const plan = planChange(current({ scheduledAt: T1 }), {});
      expect(plan.data.scheduledAt).toBeUndefined();
      expect(plan.data.status).toBeUndefined();
    });
  });
});
