export interface ComplianceSettings {
  /** Whether the hourly in-process compliance job (Blueprint 4.7 "scheduled
   * compliance-deadline checks", @nestjs/schedule) runs on its schedule. It is
   * idempotent either way; tests switch the schedule off and call it directly.
   * Everything else about compliance - obligations, first due dates, due
   * windows - is a department's explicit configuration in the database, not an
   * environment setting: the requirements define none of it. */
  syncEnabled: boolean;
}

export const buildComplianceConfig = (): ComplianceSettings => ({
  syncEnabled: (process.env.COMPLIANCE_SYNC_ENABLED ?? 'true') !== 'false',
});
