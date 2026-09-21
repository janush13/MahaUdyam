import { EnterpriseAccessLevel } from '../enterprises/constants/representative-scope.constant';

/**
 * Running discovery persists a snapshot and audit entry, but changes no
 * project or enterprise data. FRD §20.3 gives View Only "view" powers and
 * Prepare & Submit the powers to prepare applications — the checklist that
 * discovery produces is the first step of that preparation, so running it
 * needs PREPARE_SUBMIT. Reading stored results needs only VIEW_ONLY. Named
 * constants so relaxing either is a one-line, reviewable change.
 */
export const DISCOVERY_RUN_LEVEL: EnterpriseAccessLevel = 'PREPARE_SUBMIT';
export const DISCOVERY_READ_LEVEL: EnterpriseAccessLevel = 'VIEW_ONLY';
