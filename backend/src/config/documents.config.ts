export type DocumentScannerDriver = 'mock';

export interface DocumentSettings {
  /** Platform-wide ceiling for one uploaded file. A DocumentRequirement can
   * set a lower limit; it can never raise this one (FRD 14: "a configurable
   * per-document-type limit (e.g., 10MB default) — TO BE VALIDATED"). */
  maxSizeBytes: number;
  /** Which MalwareScanner implementation is bound. Only the development
   * stand-in exists; a real scanner (e.g. ClamAV) is a future adapter. */
  scanner: DocumentScannerDriver;
}

export const DEFAULT_DOCUMENT_MAX_SIZE_BYTES = 10 * 1024 * 1024;

/** Document upload settings. Defaults reproduce the architecture's ~10MB
 * per-document NFR (Blueprint 30). */
export const buildDocumentConfig = (): DocumentSettings => ({
  maxSizeBytes: parseInt(
    process.env.DOCUMENT_MAX_SIZE_BYTES ??
      String(DEFAULT_DOCUMENT_MAX_SIZE_BYTES),
    10,
  ),
  scanner: (process.env.DOCUMENT_SCANNER as DocumentScannerDriver) ?? 'mock',
});
