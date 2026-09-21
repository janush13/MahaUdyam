import { InternalApplicationState } from '@prisma/client';
import { VALIDATION_DISCLAIMER } from './constants/application.constants';
import { isEditable } from './application-state.machine';

/**
 * Pre-submission validation (FRD §16; Blueprint §22's ValidationService),
 * as a pure function over already-loaded facts. Only checks the requirements
 * actually define and that exist as data today:
 *
 *   - the application is still a draft;
 *   - the approval type is still active;
 *   - the approval-specific details are structurally valid;
 *   - every MANDATORY document requirement configured for the approval type
 *     has a document attached (FRD §16.1 "Missing Documents — blocks if the
 *     document is mandatory").
 *
 * No statutory document list, mandatory field, fee or SLA is invented: if a
 * department has configured none, none is required. Warnings (FRD §16.1) need
 * cross-document data that does not exist until the document module, so the
 * list is always empty for now but is part of the result shape.
 */
export interface ValidationIssue {
  code: string;
  field?: string;
  message: string;
}

export interface MissingDocument {
  requirementId: string;
  name: string;
}

export interface ReadinessInput {
  internalState: InternalApplicationState;
  approvalTypeActive: boolean;
  formDataErrors: Record<string, string[]>;
  mandatoryRequirements: ReadonlyArray<{ id: string; name: string }>;
  /** Requirement ids that have a usable document attached. */
  satisfiedRequirementIds: ReadonlySet<string>;
  /** Current documents that must be replaced first (expired / rejected).
   * Optional so callers with no document facts keep working. */
  documentIssues?: ReadonlyArray<{
    documentId: string;
    filename: string;
    reason: 'EXPIRED' | 'REJECTED';
  }>;
}

export interface ValidationSummary {
  errors: ValidationIssue[];
  warnings: ValidationIssue[];
  missingDocuments: MissingDocument[];
  readyForSubmission: boolean;
  disclaimer: string;
}

/** Locale-independent, so the order is identical on every machine. */
function compareStrings(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

export function evaluateSubmissionReadiness(
  input: ReadinessInput,
): ValidationSummary {
  const errors: ValidationIssue[] = [];

  if (!isEditable(input.internalState)) {
    errors.push({
      code: 'NOT_A_DRAFT',
      message: 'Only a draft application can be submitted.',
    });
  }
  if (!input.approvalTypeActive) {
    errors.push({
      code: 'APPROVAL_TYPE_INACTIVE',
      message: 'This approval is no longer available for new submissions.',
    });
  }
  for (const [field, messages] of Object.entries(input.formDataErrors)) {
    for (const message of messages) {
      errors.push({ code: 'INVALID_FIELD', field, message });
    }
  }

  for (const issue of input.documentIssues ?? []) {
    errors.push({
      code:
        issue.reason === 'EXPIRED' ? 'DOCUMENT_EXPIRED' : 'DOCUMENT_REJECTED',
      field: 'documents',
      message:
        issue.reason === 'EXPIRED'
          ? `"${issue.filename}" has expired and must be replaced.`
          : `"${issue.filename}" was rejected and must be replaced.`,
    });
  }

  const missingDocuments = input.mandatoryRequirements
    .filter((r) => !input.satisfiedRequirementIds.has(r.id))
    .map((r) => ({ requirementId: r.id, name: r.name }))
    .sort(
      (a, b) =>
        compareStrings(a.name, b.name) ||
        compareStrings(a.requirementId, b.requirementId),
    );

  return {
    errors,
    warnings: [],
    missingDocuments,
    readyForSubmission: errors.length === 0 && missingDocuments.length === 0,
    disclaimer: VALIDATION_DISCLAIMER,
  };
}
