import { buildSlaConfig } from './sla.config';

const KEYS = [
  'SLA_SWEEP_ENABLED',
  'SLA_UTC_OFFSET_MINUTES',
  'SLA_WEEKEND_DAYS',
  'SLA_WARNING_THRESHOLD_PERCENT',
];

describe('buildSlaConfig', () => {
  const saved: Record<string, string | undefined> = {};
  beforeEach(() => {
    for (const k of KEYS) {
      saved[k] = process.env[k];
      delete process.env[k];
    }
  });
  afterEach(() => {
    for (const k of KEYS) {
      if (saved[k] === undefined) {
        delete process.env[k];
      } else {
        process.env[k] = saved[k];
      }
    }
  });

  it('ships no SLA duration and no warning threshold: only calendar mechanics have defaults', () => {
    expect(buildSlaConfig()).toEqual({
      sweepEnabled: true,
      utcOffsetMinutes: 330,
      weekendDays: [0, 6],
      warningThresholdPercent: null,
    });
  });

  it('reads the sweep switch, offset, weekend and threshold from the environment', () => {
    process.env.SLA_SWEEP_ENABLED = 'false';
    process.env.SLA_UTC_OFFSET_MINUTES = '0';
    process.env.SLA_WEEKEND_DAYS = '5, 6';
    process.env.SLA_WARNING_THRESHOLD_PERCENT = '75';
    expect(buildSlaConfig()).toEqual({
      sweepEnabled: false,
      utcOffsetMinutes: 0,
      weekendDays: [5, 6],
      warningThresholdPercent: 75,
    });
  });

  it('an empty weekend is allowed (every weekday works)', () => {
    process.env.SLA_WEEKEND_DAYS = '';
    expect(buildSlaConfig().weekendDays).toEqual([]);
  });

  it('falls back safely on invalid values rather than loop or misbehave', () => {
    process.env.SLA_WEEKEND_DAYS = '0,1,2,3,4,5,6';
    process.env.SLA_UTC_OFFSET_MINUTES = 'abc';
    process.env.SLA_WARNING_THRESHOLD_PERCENT = '150';
    expect(buildSlaConfig()).toMatchObject({
      weekendDays: [0, 6],
      utcOffsetMinutes: 330,
      warningThresholdPercent: null,
    });
    process.env.SLA_WEEKEND_DAYS = '7,x';
    expect(buildSlaConfig().weekendDays).toEqual([0, 6]);
    process.env.SLA_WARNING_THRESHOLD_PERCENT = '0';
    expect(buildSlaConfig().warningThresholdPercent).toBeNull();
  });
});
