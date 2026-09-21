import { InternalApplicationState, InspectionStatus } from '@prisma/client';
import { WORKING_STATES } from '../../officer/scrutiny-state.machine';

export const INSPECTOR_ROLE = 'INSPECTOR';

export const MAX_SITE_ADDRESS_LENGTH = 500;
export const MAX_REASON_LENGTH = 500;
export const MAX_RESULT_TEXT_LENGTH = 2000;
export const MAX_REPORT_TEXT_LENGTH = 5000;
export const MAX_CAPTION_LENGTH = 500;
/** A capture time a little ahead of the server clock is tolerated (device
 * clocks drift); one clearly in the future is refused. */
export const CAPTURE_TIME_SKEW_MS = 5 * 60_000;
export const DEFAULT_PAGE_SIZE = 25;
export const MAX_PAGE_SIZE = 100;

/** Inspections that are still to happen. At most one per application (a
 * partial unique index); finished / cancelled ones never block a further one. */
export const OPEN_STATUSES: readonly InspectionStatus[] = [
  'PENDING',
  'SCHEDULED',
];

/**
 * TRD 3.3: "scrutiny triggers inspection before recommendation" — an
 * inspection is requested while the application is UNDER_SCRUTINY (FRD 4.3
 * "assign/request inspection" is a scrutiny-officer action). Not while a query
 * is out with the applicant, and never after the recommendation.
 */
export const INSPECTION_CREATION_STATES: readonly InternalApplicationState[] = [
  'UNDER_SCRUTINY',
];

/** An open inspection's assignment/schedule can be changed while scrutiny is
 * still under way (including while a query is out), never after it finished. */
export const INSPECTION_CHANGE_STATES: readonly InternalApplicationState[] =
  WORKING_STATES;

/** Conflict-of-interest states that block an assignment (TRD 10.1: a declared
 * conflict needs an admin review; only a CLEARED declaration lets it proceed). */
export const BLOCKING_CONFLICT_STATUSES = ['DECLARED', 'CONFIRMED'] as const;
