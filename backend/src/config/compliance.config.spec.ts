import { buildComplianceConfig } from './compliance.config';

describe('buildComplianceConfig', () => {
  const original = process.env;
  beforeEach(() => {
    process.env = { ...original };
    delete process.env.COMPLIANCE_SYNC_ENABLED;
  });
  afterAll(() => {
    process.env = original;
  });

  it('runs the hourly job by default', () => {
    expect(buildComplianceConfig()).toEqual({ syncEnabled: true });
  });

  it('switches off only for an explicit "false"', () => {
    process.env.COMPLIANCE_SYNC_ENABLED = 'false';
    expect(buildComplianceConfig().syncEnabled).toBe(false);
    process.env.COMPLIANCE_SYNC_ENABLED = '0';
    expect(buildComplianceConfig().syncEnabled).toBe(true);
  });

  it('defines no obligation, due date or window: those are a department’s configuration in the database', () => {
    expect(Object.keys(buildComplianceConfig())).toEqual(['syncEnabled']);
  });
});
