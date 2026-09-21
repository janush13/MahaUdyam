import { VALIDATION_DISCLAIMER } from './constants/application.constants';
import { evaluateSubmissionReadiness } from './application-readiness';

const base = {
  internalState: 'DRAFT' as const,
  approvalTypeActive: true,
  formDataErrors: {},
  mandatoryRequirements: [] as Array<{ id: string; name: string }>,
  satisfiedRequirementIds: new Set<string>(),
};

describe('evaluateSubmissionReadiness', () => {
  it('is ready when nothing is configured as mandatory (no invented requirements)', () => {
    expect(evaluateSubmissionReadiness(base)).toMatchObject({
      errors: [],
      warnings: [],
      missingDocuments: [],
      readyForSubmission: true,
    });
  });

  it('always carries the FRD 16.2 disclaimer, verbatim', () => {
    expect(evaluateSubmissionReadiness(base).disclaimer).toBe(
      VALIDATION_DISCLAIMER,
    );
    expect(VALIDATION_DISCLAIMER).toBe(
      'Passing these checks confirms your application is complete for submission. It does not guarantee approval by the relevant department, which will conduct its own review.',
    );
  });

  it('blocks a non-draft', () => {
    const summary = evaluateSubmissionReadiness({
      ...base,
      internalState: 'SUBMITTED',
    });
    expect(summary.readyForSubmission).toBe(false);
    expect(summary.errors.map((e) => e.code)).toContain('NOT_A_DRAFT');
  });

  it('blocks an inactive approval type', () => {
    const summary = evaluateSubmissionReadiness({
      ...base,
      approvalTypeActive: false,
    });
    expect(summary.readyForSubmission).toBe(false);
    expect(summary.errors.map((e) => e.code)).toContain(
      'APPROVAL_TYPE_INACTIVE',
    );
  });

  it('reports each invalid form field as a blocking error with its field', () => {
    const summary = evaluateSubmissionReadiness({
      ...base,
      formDataErrors: { 'formData.a': ['bad', 'worse'], 'formData.b': ['no'] },
    });
    expect(summary.readyForSubmission).toBe(false);
    expect(summary.errors).toEqual([
      { code: 'INVALID_FIELD', field: 'formData.a', message: 'bad' },
      { code: 'INVALID_FIELD', field: 'formData.a', message: 'worse' },
      { code: 'INVALID_FIELD', field: 'formData.b', message: 'no' },
    ]);
  });

  it('lists mandatory documents that are not attached, sorted, and blocks', () => {
    const summary = evaluateSubmissionReadiness({
      ...base,
      mandatoryRequirements: [
        { id: 'r2', name: 'Site plan' },
        { id: 'r1', name: 'Identity proof' },
        { id: 'r3', name: 'Lease deed' },
      ],
      satisfiedRequirementIds: new Set(['r3']),
    });
    expect(summary.missingDocuments).toEqual([
      { requirementId: 'r1', name: 'Identity proof' },
      { requirementId: 'r2', name: 'Site plan' },
    ]);
    expect(summary.readyForSubmission).toBe(false);
    expect(summary.errors).toEqual([]);
  });

  it('is ready once every mandatory document is attached', () => {
    const summary = evaluateSubmissionReadiness({
      ...base,
      mandatoryRequirements: [{ id: 'r1', name: 'Identity proof' }],
      satisfiedRequirementIds: new Set(['r1']),
    });
    expect(summary.readyForSubmission).toBe(true);
  });

  it('is deterministic: input order does not change the output', () => {
    const input = {
      ...base,
      mandatoryRequirements: [
        { id: 'b', name: 'B' },
        { id: 'a', name: 'A' },
      ],
    };
    expect(evaluateSubmissionReadiness(input)).toEqual(
      evaluateSubmissionReadiness({
        ...input,
        mandatoryRequirements: [...input.mandatoryRequirements].reverse(),
      }),
    );
  });

  it('blocks on expired and rejected current documents, naming each file', () => {
    const summary = evaluateSubmissionReadiness({
      ...base,
      documentIssues: [
        { documentId: 'a', filename: 'lease.pdf', reason: 'EXPIRED' },
        { documentId: 'b', filename: 'id.png', reason: 'REJECTED' },
      ],
    });
    expect(summary.readyForSubmission).toBe(false);
    expect(summary.errors).toEqual([
      {
        code: 'DOCUMENT_EXPIRED',
        field: 'documents',
        message: '"lease.pdf" has expired and must be replaced.',
      },
      {
        code: 'DOCUMENT_REJECTED',
        field: 'documents',
        message: '"id.png" was rejected and must be replaced.',
      },
    ]);
  });

  it('treats absent document issues as none (older callers keep working)', () => {
    expect(evaluateSubmissionReadiness(base).readyForSubmission).toBe(true);
    expect(
      evaluateSubmissionReadiness({ ...base, documentIssues: [] })
        .readyForSubmission,
    ).toBe(true);
  });
});
