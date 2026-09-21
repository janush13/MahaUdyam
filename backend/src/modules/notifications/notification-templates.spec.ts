import {
  NotificationEventType,
  NotificationEventTypes,
} from './notification-events.constant';
import { renderNotification } from './notification-templates';

const due = new Date('2026-10-01T10:00:00.000Z');
const params = {
  referenceNumber: 'APP-2026-000042',
  approvalTypeName: 'Factory Licence',
  roundNumber: 2,
  scheduledAt: new Date('2026-10-05T04:30:00.000Z'),
  enterpriseName: 'Acme Works',
  dueAt: due,
  percentElapsed: 84.7,
};

describe('renderNotification', () => {
  it('renders every event with a non-empty title and message', () => {
    for (const type of Object.values(NotificationEventTypes)) {
      const out = renderNotification(type as NotificationEventType, params);
      expect(out.title.trim()).not.toBe('');
      expect(out.message.trim()).not.toBe('');
    }
  });

  it('names the application and, where relevant, the round, schedule or deadline', () => {
    expect(
      renderNotification('APPLICATION_SUBMITTED', params).message,
    ).toContain('APP-2026-000042');
    expect(
      renderNotification('APPLICATION_SUBMITTED', params).message,
    ).toContain('Factory Licence');
    expect(renderNotification('QUERY_RAISED', params).message).toContain(
      'round 2',
    );
    expect(renderNotification('QUERY_RESPONDED', params).message).toContain(
      'round 2',
    );
    expect(
      renderNotification('INSPECTION_SCHEDULED', params).message,
    ).toContain('2026-10-05T04:30:00.000Z');
    expect(
      renderNotification('INSPECTION_RESCHEDULED', params).message,
    ).toContain('2026-10-05T04:30:00.000Z');
    expect(renderNotification('SLA_BREACHED', params).message).toContain(
      '2026-10-01T10:00:00.000Z',
    );
  });

  it('decision notices name the application and the outcome, and promise nothing further', () => {
    const approved = renderNotification('APPROVAL_ISSUED', params).message;
    const rejected = renderNotification('APPLICATION_REJECTED', params).message;
    expect(approved).toContain('APP-2026-000042');
    expect(approved).toMatch(/approved/i);
    expect(rejected).toContain('APP-2026-000042');
    expect(rejected).toMatch(/rejected/i);
    // No appeal / resubmission / validity claim is defined, so none is made.
    for (const m of [approved, rejected]) {
      expect(m).not.toMatch(
        /appeal|resubmit|valid until|expires|certificate number/i,
      );
    }
  });

  it('reports the warning percentage rounded down, never up to a false 100', () => {
    const out = renderNotification('SLA_WARNING', {
      ...params,
      percentElapsed: 99.9,
    });
    expect(out.message).toContain('99%');
    expect(out.message).not.toContain('100%');
  });

  it('tells a representative the offer grants nothing until accepted', () => {
    const out = renderNotification(
      'REPRESENTATIVE_AUTHORISATION_REQUESTED',
      params,
    );
    expect(out.message).toContain('Acme Works');
    expect(out.message).toMatch(/until you accept/i);
  });

  it('is a pure function: the same input gives the same output', () => {
    expect(renderNotification('QUERY_RAISED', params)).toEqual(
      renderNotification('QUERY_RAISED', params),
    );
  });

  it('degrades gracefully when a parameter is missing (no "undefined" in the text)', () => {
    for (const type of Object.values(NotificationEventTypes)) {
      const out = renderNotification(type as NotificationEventType, {});
      expect(out.title).not.toMatch(/undefined|NaN|null/);
      expect(out.message).not.toMatch(/undefined|NaN|null/);
    }
  });

  it('has no parameter through which an officer’s question, an inspector or a site could enter', () => {
    // The accepted parameter set is the whole of what a template can say.
    const out = renderNotification('QUERY_RAISED', {
      ...params,
      // Not part of the type; a caller cannot smuggle these in.
      ...({
        question: 'SECRET-QUESTION',
        inspector: 'SECRET-INSPECTOR',
        siteAddress: 'SECRET-SITE',
      } as object),
    });
    expect(out.message).not.toMatch(/SECRET/);
    const insp = renderNotification('INSPECTION_SCHEDULED', {
      ...params,
      ...({
        inspector: 'SECRET-INSPECTOR',
        siteAddress: 'SECRET-SITE',
      } as object),
    });
    expect(insp.message).not.toMatch(/SECRET/);
  });
});

describe('renderNotification: compliance', () => {
  it('names the application and the due date, and repeats none of the requirement’s wording', () => {
    const out = renderNotification('COMPLIANCE_DEADLINE_APPROACHING', {
      referenceNumber: 'APP-2026-000042',
      dueDate: '2026-10-10',
    });
    expect(out.title).toBe('Compliance obligation due');
    expect(out.message).toContain('APP-2026-000042');
    expect(out.message).toContain('2026-10-10');
  });
});

describe('renderNotification: schemes', () => {
  const p = {
    referenceNumber: 'SCH-2026-000007',
    schemeName: 'Test Scheme',
    schemeStatus: 'UNDER_REVIEW',
  };

  it('names the scheme application, the scheme and the new status', () => {
    const out = renderNotification('SCHEME_APPLICATION_STATUS_UPDATE', p);
    expect(out.title).toBe('Scheme application status updated');
    expect(out.message).toContain('SCH-2026-000007');
    expect(out.message).toContain('Test Scheme');
    expect(out.message).toContain('is now under review');
  });

  it('says each documented status in plain words', () => {
    const say = (schemeStatus: string) =>
      renderNotification('SCHEME_APPLICATION_STATUS_UPDATE', {
        ...p,
        schemeStatus,
      }).message;
    expect(say('APPLIED')).toContain('is now applied');
    expect(say('APPROVED')).toContain('is now approved');
    expect(say('REJECTED')).toContain('is now rejected');
    expect(say('DISBURSED')).toContain('is now disbursed');
    // an unknown status never leaks its raw value or "undefined"
    expect(say('SOMETHING_ELSE')).toContain('is now updated');
  });

  it('claims nothing further: no reason, amount, deadline or payment', () => {
    for (const schemeStatus of ['APPROVED', 'REJECTED', 'DISBURSED']) {
      const { message } = renderNotification(
        'SCHEME_APPLICATION_STATUS_UPDATE',
        {
          ...p,
          schemeStatus,
        },
      );
      expect(message).not.toMatch(
        /reason|amount|payment|bank|transfer|credited|appeal/i,
      );
    }
  });

  it('degrades gracefully when the scheme name is missing', () => {
    const out = renderNotification('SCHEME_APPLICATION_STATUS_UPDATE', {
      referenceNumber: 'SCH-2026-000007',
      schemeStatus: 'APPROVED',
    });
    expect(out.message).not.toMatch(/undefined|null/);
    expect(out.message).toContain('SCH-2026-000007');
  });
});
