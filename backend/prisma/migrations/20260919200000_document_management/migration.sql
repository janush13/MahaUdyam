-- Step 9: Document management + storage.
--
-- Documents are owned by the enterprise/project and attached to applications
-- through application_documents (TRD 6.2). Replacement is NON-destructive: a
-- new immutable row per version, chained by replaced_document_id and grouped by
-- lineage_id. No statutory data, retention period or document requirement is
-- seeded.

-- AlterTable
ALTER TABLE "approval_applications" ADD COLUMN     "submitted_documents" JSONB;

-- AlterTable: lineage_id / scanned_at / scanner_name. The default only
-- back-fills any pre-existing row (none can exist: there was no upload path).
ALTER TABLE "documents" ADD COLUMN     "lineage_id" UUID NOT NULL DEFAULT gen_random_uuid(),
ADD COLUMN     "scanned_at" TIMESTAMP(3),
ADD COLUMN     "scanner_name" TEXT;

-- CreateIndex: a version number is unique within its chain, so two
-- concurrent replacements of the same version cannot both succeed.
CREATE UNIQUE INDEX "documents_lineage_id_version_key" ON "documents"("lineage_id", "version");

-- CreateIndex: one stored object backs exactly one row (no shared/overwritten keys).
CREATE UNIQUE INDEX "documents_file_path_key" ON "documents"("file_path");

-- Version chain coherence: version 1 has no predecessor, every later version has one.
ALTER TABLE "documents"
  ADD CONSTRAINT "documents_version_chain_check"
  CHECK (("replaced_document_id" IS NULL) = ("version" = 1));

-- Immutability of a document version's identity, enforced by PostgreSQL.
-- What the file IS (storage key, checksum, name, type, size), where it belongs
-- (owner, requirement, chain position), who uploaded it / when, and how it was
-- scanned can never change; replacing a document means writing a NEW version.
-- Deliberately mutable: status (server-controlled transitions: verification,
-- rejection, expiry belong to later steps), expiry_date, updated_at.
-- documents.document_requirement_id may only be cleared (the FK is SET NULL
-- when a requirement is deleted), never re-pointed.
CREATE FUNCTION documents_enforce_immutability() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.owner_type IS DISTINCT FROM OLD.owner_type
     OR NEW.owner_id IS DISTINCT FROM OLD.owner_id
     OR NEW.file_path IS DISTINCT FROM OLD.file_path
     OR NEW.checksum IS DISTINCT FROM OLD.checksum
     OR NEW.original_filename IS DISTINCT FROM OLD.original_filename
     OR NEW.mime_type IS DISTINCT FROM OLD.mime_type
     OR NEW.size_bytes IS DISTINCT FROM OLD.size_bytes
     OR NEW.version IS DISTINCT FROM OLD.version
     OR NEW.replaced_document_id IS DISTINCT FROM OLD.replaced_document_id
     OR NEW.lineage_id IS DISTINCT FROM OLD.lineage_id
     OR NEW.uploaded_by IS DISTINCT FROM OLD.uploaded_by
     OR NEW.created_at IS DISTINCT FROM OLD.created_at
     OR NEW.scanned_at IS DISTINCT FROM OLD.scanned_at
     OR NEW.scanner_name IS DISTINCT FROM OLD.scanner_name
     OR (OLD.document_requirement_id IS NOT NULL
         AND NEW.document_requirement_id IS NOT NULL
         AND NEW.document_requirement_id IS DISTINCT FROM OLD.document_requirement_id) THEN
    RAISE EXCEPTION 'documents: a document version is immutable; upload a replacement to create a new version'
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER documents_immutable
  BEFORE UPDATE ON "documents"
  FOR EACH ROW EXECUTE FUNCTION documents_enforce_immutability();

-- The application <-> document association is pure glue: it is created once
-- and never re-pointed.
CREATE FUNCTION application_documents_reject_update() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'application_documents: an association is immutable'
    USING ERRCODE = 'integrity_constraint_violation';
END $$;

CREATE TRIGGER application_documents_immutable
  BEFORE UPDATE ON "application_documents"
  FOR EACH ROW EXECUTE FUNCTION application_documents_reject_update();

-- The submitted-document snapshot is frozen once written. This REPLACES the
-- Step 8 function body with the identical rules plus that one clause (the
-- earlier migration file is untouched).
CREATE OR REPLACE FUNCTION approval_applications_enforce_immutability() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.project_id IS DISTINCT FROM OLD.project_id
     OR NEW.approval_type_id IS DISTINCT FROM OLD.approval_type_id
     OR NEW.workflow_id IS DISTINCT FROM OLD.workflow_id
     OR NEW.discovery_snapshot_id IS DISTINCT FROM OLD.discovery_snapshot_id
     OR NEW.discovery_context IS DISTINCT FROM OLD.discovery_context
     OR NEW.created_by_user_id IS DISTINCT FROM OLD.created_by_user_id
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'approval_applications: project, approval type, workflow, discovery context and author are immutable'
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  IF (OLD.reference_number IS NOT NULL AND NEW.reference_number IS DISTINCT FROM OLD.reference_number)
     OR (OLD.submitted_at IS NOT NULL AND NEW.submitted_at IS DISTINCT FROM OLD.submitted_at)
     OR (OLD.submitted_by_user_id IS NOT NULL AND NEW.submitted_by_user_id IS DISTINCT FROM OLD.submitted_by_user_id)
     OR (OLD.declaration_accepted_at IS NOT NULL AND NEW.declaration_accepted_at IS DISTINCT FROM OLD.declaration_accepted_at)
     OR (OLD.submitted_documents IS NOT NULL AND NEW.submitted_documents IS DISTINCT FROM OLD.submitted_documents) THEN
    RAISE EXCEPTION 'approval_applications: reference number and submission record are permanent once set'
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN NEW;
END $$;
