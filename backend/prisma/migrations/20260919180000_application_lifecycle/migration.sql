-- Step 8: Application lifecycle (create / edit while draft / submit).
--
-- Adds to approval_applications: the link to the persisted Step 7 discovery
-- snapshot (+ a copy of the matched rule context), the approval-specific
-- form data, the declaration timestamp and who created / submitted it.
-- No statutory data is seeded and no workflow/fee/SLA value is introduced.
--
-- created_by_user_id is NOT NULL without a default: no code path could
-- create an application before this step, so the table is empty; on a
-- non-empty table this migration fails loudly instead of inventing an author.

-- AlterTable
ALTER TABLE "approval_applications" ADD COLUMN     "created_by_user_id" UUID NOT NULL,
ADD COLUMN     "declaration_accepted_at" TIMESTAMP(3),
ADD COLUMN     "discovery_context" JSONB,
ADD COLUMN     "discovery_snapshot_id" UUID,
ADD COLUMN     "form_data" JSONB NOT NULL DEFAULT '{}',
ADD COLUMN     "submitted_by_user_id" UUID;

-- CreateIndex
CREATE INDEX "approval_applications_discovery_snapshot_id_idx" ON "approval_applications"("discovery_snapshot_id");

-- CreateIndex
CREATE INDEX "approval_applications_project_id_approval_type_id_idx" ON "approval_applications"("project_id", "approval_type_id");

-- AddForeignKey
ALTER TABLE "approval_applications" ADD CONSTRAINT "approval_applications_discovery_snapshot_id_fkey" FOREIGN KEY ("discovery_snapshot_id") REFERENCES "discovery_snapshots"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approval_applications" ADD CONSTRAINT "approval_applications_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approval_applications" ADD CONSTRAINT "approval_applications_submitted_by_user_id_fkey" FOREIGN KEY ("submitted_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Application Reference Number (FRD §17.2): generated at SUBMISSION, unique
-- and permanent, race-free via a sequence. Same convention as the enterprise
-- (ENT-) and project (PRJ-) reference numbers; the format is a platform
-- convention, not a statutory one. The service calls nextval() in the
-- submitting transaction; drafts have no reference number.
CREATE SEQUENCE application_reference_seq;

-- A reference number only ever exists on a submitted application.
ALTER TABLE "approval_applications"
  ADD CONSTRAINT "approval_applications_reference_requires_submission"
  CHECK ("reference_number" IS NULL OR "submitted_at" IS NOT NULL);

-- Historical correctness enforced by PostgreSQL itself, not only by service
-- code. What an application is ABOUT (project, approval type, workflow
-- version, discovery snapshot + context, author) can never change; once a
-- reference number / submission timestamp / submitter / declaration exist they
-- are permanent. Deliberately NOT locked here: internal_state, applicant_status
-- and form_data — later steps (scrutiny, the controlled query/correction
-- mechanism of FRD §17.3) legitimately change them; the Step 8 service
-- enforces "form data is editable only while DRAFT" atomically.
CREATE FUNCTION approval_applications_enforce_immutability() RETURNS trigger
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
     OR (OLD.declaration_accepted_at IS NOT NULL AND NEW.declaration_accepted_at IS DISTINCT FROM OLD.declaration_accepted_at) THEN
    RAISE EXCEPTION 'approval_applications: reference number and submission record are permanent once set'
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER approval_applications_immutable
  BEFORE UPDATE ON "approval_applications"
  FOR EACH ROW EXECUTE FUNCTION approval_applications_enforce_immutability();
