-- Step 14: compliance management.
--
-- FRD 27 / TRD 14 / Blueprint 12.6 + 13.8. The compliance tables already exist
-- (init migration) and have never been written to; this migration gives them
-- what a post-approval compliance calendar needs:
--   * on the REQUIREMENT (a department's explicit configuration, never seeded):
--     a source reference, whether evidence is required, the applicant action,
--     an optional first-due offset (NULL = "not yet configured": the
--     requirements define no duration), a due window, a version and an active
--     flag;
--   * on the RECORD (one row per occurrence): the occurrence number, a
--     nullable calendar due date, a SNAPSHOT of the requirement it was created
--     under (so a later change never re-times or re-words it), and who fulfilled
--     it and when.
-- The tables are empty, so the NOT NULL columns are added with a temporary
-- default which is dropped again; nothing else needs back-filling.

-- AlterTable
ALTER TABLE "compliance_requirements" ADD COLUMN     "applicant_action" TEXT,
ADD COLUMN     "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "due_window_days" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "evidence_required" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "first_due_after_days" INTEGER,
ADD COLUMN     "is_active" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "source_reference" TEXT,
ADD COLUMN     "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "version" INTEGER NOT NULL DEFAULT 1;

ALTER TABLE "compliance_requirements" ALTER COLUMN "updated_at" DROP DEFAULT;

-- AlterTable
ALTER TABLE "compliance_records" ADD COLUMN     "applicant_action" TEXT,
ADD COLUMN     "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "description" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "due_window_days" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "evidence_required" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "frequency" "compliance_frequency" NOT NULL DEFAULT 'ONE_TIME',
ADD COLUMN     "fulfilled_at" TIMESTAMP(3),
ADD COLUMN     "fulfilled_by_user_id" UUID,
ADD COLUMN     "occurrence_number" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "requirement_version" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "source_reference" TEXT,
ALTER COLUMN "due_date" DROP NOT NULL,
ALTER COLUMN "due_date" SET DATA TYPE DATE;

ALTER TABLE "compliance_records"
  ALTER COLUMN "description" DROP DEFAULT,
  ALTER COLUMN "due_window_days" DROP DEFAULT,
  ALTER COLUMN "evidence_required" DROP DEFAULT,
  ALTER COLUMN "frequency" DROP DEFAULT,
  ALTER COLUMN "requirement_version" DROP DEFAULT;

-- CreateIndex
CREATE INDEX "compliance_records_compliance_requirement_id_idx" ON "compliance_records"("compliance_requirement_id");

-- CreateIndex
CREATE INDEX "compliance_records_status_due_date_idx" ON "compliance_records"("status", "due_date");

-- CreateIndex
CREATE UNIQUE INDEX "compliance_records_application_id_compliance_requirement_id_key" ON "compliance_records"("application_id", "compliance_requirement_id", "occurrence_number");

-- AddForeignKey
ALTER TABLE "compliance_records" ADD CONSTRAINT "compliance_records_fulfilled_by_user_id_fkey" FOREIGN KEY ("fulfilled_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ---------------------------------------------------------------------------
-- Integrity enforced by PostgreSQL itself (not only by service code)
-- ---------------------------------------------------------------------------

-- A requirement: a real description, non-negative offsets (no duration is
-- defaulted: NULL means not configured), sane bounds, a version that only
-- counts up, and an approval type that never changes.
ALTER TABLE "compliance_requirements"
  ADD CONSTRAINT "compliance_requirements_config_check" CHECK (
    length(btrim("description")) > 0
    AND ("first_due_after_days" IS NULL OR "first_due_after_days" BETWEEN 0 AND 3650)
    AND "due_window_days" BETWEEN 0 AND 3650
    AND "version" >= 1
  );

CREATE FUNCTION compliance_requirements_enforce() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.approval_type_id IS DISTINCT FROM OLD.approval_type_id
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'compliance_requirements: the approval type a requirement belongs to never changes'
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  IF NEW.version < OLD.version THEN
    RAISE EXCEPTION 'compliance_requirements: the version never goes back'
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER compliance_requirements_integrity
  BEFORE UPDATE ON "compliance_requirements"
  FOR EACH ROW EXECUTE FUNCTION compliance_requirements_enforce();

-- A record: coherent fulfilment and a positive occurrence.
--   * FULFILLED  <=>  fulfilled_at and fulfilled_by are set;
--   * no due date  =>  it can only be UPCOMING or FULFILLED (nothing to be due
--     or overdue against).
ALTER TABLE "compliance_records"
  ADD CONSTRAINT "compliance_records_state_check" CHECK (
    "occurrence_number" >= 1
    AND "requirement_version" >= 1
    AND length(btrim("description")) > 0
    AND "due_window_days" >= 0
    AND ("status" = 'FULFILLED') = ("fulfilled_at" IS NOT NULL)
    AND ("status" = 'FULFILLED') = ("fulfilled_by_user_id" IS NOT NULL)
    AND ("status" = 'FULFILLED' OR "fulfilled_document_id" IS NULL)
    AND ("due_date" IS NOT NULL OR "status" IN ('UPCOMING', 'FULFILLED'))
  );

-- The lifecycle (FRD 27.1 "Upcoming -> Due -> Overdue -> Fulfilled"):
--   born UPCOMING, only for an obligation of the application's own approval type
--   and only while the approval is ACTIVE (TRD 3.2 "ACTIVE (compliance period)");
--   UPCOMING -> DUE | OVERDUE | FULFILLED, DUE -> OVERDUE | FULFILLED,
--   OVERDUE -> FULFILLED, and nothing else: FULFILLED is permanent (only the
--   document reference may be nulled, by its foreign key, if the file is ever
--   removed). What a record was created under (application, requirement,
--   occurrence, due date, the snapshot) never changes. FULFILLED needs the
--   evidence the snapshot says is required.
CREATE FUNCTION compliance_records_enforce() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  app_state internal_application_state;
BEGIN
  IF TG_OP = 'INSERT' THEN
    SELECT a.internal_state INTO app_state
      FROM approval_applications a
      JOIN compliance_requirements r ON r.approval_type_id = a.approval_type_id
     WHERE a.id = NEW.application_id AND r.id = NEW.compliance_requirement_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'compliance_records: the requirement does not belong to the approval type of the application'
        USING ERRCODE = 'integrity_constraint_violation';
    END IF;
    IF app_state <> 'ACTIVE' THEN
      RAISE EXCEPTION 'compliance_records: obligations exist only while the approval is ACTIVE'
        USING ERRCODE = 'integrity_constraint_violation';
    END IF;
    IF NEW.status <> 'UPCOMING' THEN
      RAISE EXCEPTION 'compliance_records: an obligation is born UPCOMING'
        USING ERRCODE = 'integrity_constraint_violation';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.application_id IS DISTINCT FROM OLD.application_id
     OR NEW.compliance_requirement_id IS DISTINCT FROM OLD.compliance_requirement_id
     OR NEW.occurrence_number IS DISTINCT FROM OLD.occurrence_number
     OR NEW.due_date IS DISTINCT FROM OLD.due_date
     OR NEW.requirement_version IS DISTINCT FROM OLD.requirement_version
     OR NEW.description IS DISTINCT FROM OLD.description
     OR NEW.frequency IS DISTINCT FROM OLD.frequency
     OR NEW.evidence_required IS DISTINCT FROM OLD.evidence_required
     OR NEW.applicant_action IS DISTINCT FROM OLD.applicant_action
     OR NEW.source_reference IS DISTINCT FROM OLD.source_reference
     OR NEW.due_window_days IS DISTINCT FROM OLD.due_window_days
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'compliance_records: what an obligation was created under never changes'
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;

  IF OLD.status = 'FULFILLED' THEN
    IF NEW.status <> 'FULFILLED'
       OR NEW.fulfilled_at IS DISTINCT FROM OLD.fulfilled_at
       OR NEW.fulfilled_by_user_id IS DISTINCT FROM OLD.fulfilled_by_user_id
       OR (NEW.fulfilled_document_id IS DISTINCT FROM OLD.fulfilled_document_id
           AND NEW.fulfilled_document_id IS NOT NULL) THEN
      RAISE EXCEPTION 'compliance_records: a fulfilled obligation is permanent'
        USING ERRCODE = 'integrity_constraint_violation';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.status IS DISTINCT FROM OLD.status THEN
    IF NOT ((OLD.status = 'UPCOMING' AND NEW.status IN ('DUE', 'OVERDUE', 'FULFILLED'))
            OR (OLD.status = 'DUE' AND NEW.status IN ('OVERDUE', 'FULFILLED'))
            OR (OLD.status = 'OVERDUE' AND NEW.status = 'FULFILLED')) THEN
      RAISE EXCEPTION 'compliance_records: invalid status transition % -> %', OLD.status, NEW.status
        USING ERRCODE = 'integrity_constraint_violation';
    END IF;
    IF NEW.status = 'FULFILLED' AND NEW.evidence_required AND NEW.fulfilled_document_id IS NULL THEN
      RAISE EXCEPTION 'compliance_records: this obligation requires evidence to be fulfilled'
        USING ERRCODE = 'integrity_constraint_violation';
    END IF;
  ELSIF NEW.fulfilled_at IS DISTINCT FROM OLD.fulfilled_at
        OR NEW.fulfilled_by_user_id IS DISTINCT FROM OLD.fulfilled_by_user_id
        OR NEW.fulfilled_document_id IS DISTINCT FROM OLD.fulfilled_document_id THEN
    RAISE EXCEPTION 'compliance_records: fulfilment details change only with the fulfilment itself'
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER compliance_records_integrity
  BEFORE INSERT OR UPDATE ON "compliance_records"
  FOR EACH ROW EXECUTE FUNCTION compliance_records_enforce();
