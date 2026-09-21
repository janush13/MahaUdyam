import {
  CertificateRow,
  DecisionRow,
  toApplicantCertificateDto,
  toDecisionDto,
  toOfficerCertificateDto,
} from './decision.mappers';

const certificate = {
  id: 'cert-1',
  applicationId: 'app-1',
  version: 1,
  decisionId: 'dec-1',
  departmentId: 'dept-1',
  certificateNumber: null,
  documentId: 'doc-1',
  issuedByUserId: 'user-aa',
  issuedAt: new Date('2026-10-01T10:00:00Z'),
  createdAt: new Date(),
  department: { id: 'dept-1', code: 'D', name: 'Dept' },
  application: { projectId: 'proj-1', project: { enterpriseId: 'ent-1' } },
  document: {
    id: 'doc-1',
    filePath: 'documents/2026/secret-storage-key',
    originalFilename: 'c.pdf',
    mimeType: 'application/pdf',
    sizeBytes: 10,
    checksum: 'abc',
    status: 'VALIDATION_PENDING',
    scannedAt: new Date(),
  },
} as unknown as CertificateRow;

describe('decision / certificate mappers', () => {
  it('states what the recommendation advised, and whether the decision differs from it', () => {
    const base = {
      id: 'dec-1',
      applicationId: 'app-1',
      outcome: 'APPROVE',
      reason: 'r',
      decidedByUserId: 'u',
      decidedAt: new Date(),
      recommendationId: 'rec-1',
    };
    expect(
      toDecisionDto({
        ...base,
        recommendation: { outcome: 'APPROVE' },
      } as unknown as DecisionRow),
    ).toMatchObject({
      differsFromRecommendation: false,
      isStatutoryDecision: true,
    });
    expect(
      toDecisionDto({
        ...base,
        recommendation: { outcome: 'REJECT' },
      } as unknown as DecisionRow),
    ).toMatchObject({
      differsFromRecommendation: true,
      recommendedOutcome: 'REJECT',
    });
  });

  it('keeps the application, enterprise, project, department, version and date on the certificate', () => {
    expect(toApplicantCertificateDto(certificate)).toMatchObject({
      id: 'cert-1',
      applicationId: 'app-1',
      enterpriseId: 'ent-1',
      projectId: 'proj-1',
      department: { id: 'dept-1', code: 'D', name: 'Dept' },
      version: 1,
      certificateNumber: null,
      issuedAt: certificate.issuedAt,
      file: { filename: 'c.pdf', downloadable: true },
    });
  });

  it('the applicant projection hides who issued it, the decision row and the storage key', () => {
    const json = JSON.stringify(toApplicantCertificateDto(certificate));
    expect(json).not.toContain('user-aa');
    expect(json).not.toContain('dec-1');
    expect(json).not.toContain('secret-storage-key');
    expect(json).not.toContain('abc'); // the checksum
    expect(toOfficerCertificateDto(certificate)).toMatchObject({
      issuedByUserId: 'user-aa',
      decisionId: 'dec-1',
    });
    expect(JSON.stringify(toOfficerCertificateDto(certificate))).not.toContain(
      'secret-storage-key',
    );
  });
});
