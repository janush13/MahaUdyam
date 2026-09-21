-- Step 11B: Inspection execution.
--
-- The inspector's confirmation, checklist results (append-only), evidence
-- (a Step 9 document attached to an inspection) and the submitted report, plus
-- the complete inspection lifecycle enforced in PostgreSQL. No statutory data
-- is seeded; checklist items come only from department configuration. The
-- affected tables are empty and were unreachable before this step, so the new
-- NOT NULL columns need no back-fill.
-- DropForeignKey
ALTER TABLE "inspection_reports" DROP CONSTRAINT "inspection_reports_evidence_document_id_fkey";

-- DropIndex
DROP INDEX "inspection_reports_inspection_id_idx";

-- AlterTable
ALTER TABLE "inspection_reports" ADD COLUMN     "item_text" TEXT NOT NULL,
ADD COLUMN     "recorded_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "recorded_by_user_id" UUID NOT NULL;

-- AlterTable
ALTER TABLE "inspections" ADD COLUMN     "confirmed_at" TIMESTAMP(3),
ADD COLUMN     "confirmed_by_user_id" UUID;

-- CreateTable
CREATE TABLE "inspection_evidence" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "inspection_id" UUID NOT NULL,
    "document_id" UUID NOT NULL,
    "uploaded_by_user_id" UUID NOT NULL,
    "captured_at" TIMESTAMP(3),
    "caption" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "inspection_evidence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inspection_report_summaries" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "inspection_id" UUID NOT NULL,
    "overall_finding" "inspection_finding" NOT NULL,
    "summary" TEXT NOT NULL,
    "corrective_action" TEXT,
    "submitted_by_user_id" UUID NOT NULL,
    "submitted_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "inspection_report_summaries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "inspection_evidence_document_id_key" ON "inspection_evidence"("document_id");

-- CreateIndex
CREATE INDEX "inspection_evidence_inspection_id_created_at_idx" ON "inspection_evidence"("inspection_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "inspection_report_summaries_inspection_id_key" ON "inspection_report_summaries"("inspection_id");

-- CreateIndex
CREATE INDEX "inspection_reports_inspection_id_checklist_item_id_recorded_idx" ON "inspection_reports"("inspection_id", "checklist_item_id", "recorded_at");

-- AddForeignKey
ALTER TABLE "inspections" ADD CONSTRAINT "inspections_confirmed_by_user_id_fkey" FOREIGN KEY ("confirmed_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inspection_reports" ADD CONSTRAINT "inspection_reports_evidence_document_id_fkey" FOREIGN KEY ("evidence_document_id") REFERENCES "documents"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inspection_reports" ADD CONSTRAINT "inspection_reports_recorded_by_user_id_fkey" FOREIGN KEY ("recorded_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inspection_evidence" ADD CONSTRAINT "inspection_evidence_inspection_id_fkey" FOREIGN KEY ("inspection_id") REFERENCES "inspections"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inspection_evidence" ADD CONSTRAINT "inspection_evidence_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "documents"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inspection_evidence" ADD CONSTRAINT "inspection_evidence_uploaded_by_user_id_fkey" FOREIGN KEY ("uploaded_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inspection_report_summaries" ADD CONSTRAINT "inspection_report_summaries_inspection_id_fkey" FOREIGN KEY ("inspection_id") REFERENCES "inspections"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inspection_report_summaries" ADD CONSTRAINT "inspection_report_summaries_submitted_by_user_id_fkey" FOREIGN KEY ("submitted_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;



-- ---------------------------------------------------------------------------
-- Integrity enforced by PostgreSQL itself (not only by service code)
-- ---------------------------------------------------------------------------

-- A confirmation belongs to a scheduled visit and names who gave it.
ALTER TABLE "inspections"
  ADD CONSTRAINT "inspections_confirmation_check" CHECK (
    ("confirmed_at" IS NULL) = ("confirmed_by_user_id" IS NULL)
    AND ("confirmed_at" IS NULL OR "scheduled_at" IS NOT NULL)
  );

-- The inspection lifecycle, now complete for this step. Replaces the Step 11A
-- function (same name, same trigger) with the full rule set:
--   * an inspection is born PENDING or SCHEDULED;
--   * PENDING -> SCHEDULED | CANCELLED, SCHEDULED -> COMPLETED | CANCELLED and
--     nothing else (a finished / cancelled inspection is permanent);
--   * COMPLETED is impossible without a submitted report;
--   * the application, creator and creation time never change;
--   * a confirmation cannot outlive the schedule or inspector it confirmed.
CREATE OR REPLACE FUNCTION inspections_enforce_integrity() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.application_stage_id IS NOT NULL AND NOT EXISTS (
       SELECT 1 FROM application_stages s
        WHERE s.id = NEW.application_stage_id AND s.application_id = NEW.application_id) THEN
    RAISE EXCEPTION 'inspections: the workflow stage does not belong to the inspection''s application'
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.status NOT IN ('PENDING', 'SCHEDULED') THEN
      RAISE EXCEPTION 'inspections: an inspection starts PENDING or SCHEDULED, not %', NEW.status
        USING ERRCODE = 'integrity_constraint_violation';
    END IF;
  ELSE
    IF NEW.id IS DISTINCT FROM OLD.id
       OR NEW.application_id IS DISTINCT FROM OLD.application_id
       OR NEW.created_by_user_id IS DISTINCT FROM OLD.created_by_user_id
       OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
      RAISE EXCEPTION 'inspections: the application, creator and creation time are immutable'
        USING ERRCODE = 'integrity_constraint_violation';
    END IF;
    IF OLD.status IN ('COMPLETED', 'CANCELLED') THEN
      RAISE EXCEPTION 'inspections: a % inspection is permanent', OLD.status
        USING ERRCODE = 'integrity_constraint_violation';
    END IF;
    IF NEW.status IS DISTINCT FROM OLD.status THEN
      IF NOT ((OLD.status = 'PENDING' AND NEW.status IN ('SCHEDULED', 'CANCELLED'))
              OR (OLD.status = 'SCHEDULED' AND NEW.status IN ('COMPLETED', 'CANCELLED'))) THEN
        RAISE EXCEPTION 'inspections: invalid status transition % -> %', OLD.status, NEW.status
          USING ERRCODE = 'integrity_constraint_violation';
      END IF;
      IF NEW.status = 'COMPLETED' AND NOT EXISTS (
           SELECT 1 FROM inspection_report_summaries r WHERE r.inspection_id = NEW.id) THEN
        RAISE EXCEPTION 'inspections: an inspection cannot be completed without a submitted report'
          USING ERRCODE = 'integrity_constraint_violation';
      END IF;
    END IF;
    IF (NEW.scheduled_at IS DISTINCT FROM OLD.scheduled_at
        OR NEW.inspector_id IS DISTINCT FROM OLD.inspector_id)
       AND NEW.confirmed_at IS NOT NULL
       AND NEW.confirmed_at IS NOT DISTINCT FROM OLD.confirmed_at THEN
      RAISE EXCEPTION 'inspections: changing the schedule or the inspector clears the confirmation'
        USING ERRCODE = 'integrity_constraint_violation';
    END IF;
  END IF;
  RETURN NEW;
END $$;

-- Wording that must never be blank.
ALTER TABLE "inspection_reports"
  ADD CONSTRAINT "inspection_reports_response_check" CHECK (length(btrim("response")) > 0),
  ADD CONSTRAINT "inspection_reports_item_text_check" CHECK (length(btrim("item_text")) > 0);
ALTER TABLE "inspection_evidence"
  ADD CONSTRAINT "inspection_evidence_caption_check"
    CHECK ("caption" IS NULL OR length(btrim("caption")) > 0);
ALTER TABLE "inspection_report_summaries"
  ADD CONSTRAINT "inspection_report_summaries_summary_check" CHECK (length(btrim("summary")) > 0),
  -- FRD 24.2: a corrective-action recommendation "where findings are
  -- non-compliant" - so a non-compliant report always carries one.
  ADD CONSTRAINT "inspection_report_summaries_corrective_check" CHECK (
    ("corrective_action" IS NULL OR length(btrim("corrective_action")) > 0)
    AND ("overall_finding" <> 'NON_COMPLIANT' OR "corrective_action" IS NOT NULL)
  );

-- Results, evidence and the report are historical records: never edited (a
-- correction is a NEW row / a new attachment; a report is written once).
CREATE TRIGGER inspection_reports_append_only
  BEFORE UPDATE ON "inspection_reports"
  FOR EACH ROW EXECUTE FUNCTION scrutiny_reject_update();
CREATE TRIGGER inspection_evidence_append_only
  BEFORE UPDATE ON "inspection_evidence"
  FOR EACH ROW EXECUTE FUNCTION scrutiny_reject_update();
CREATE TRIGGER inspection_report_summaries_append_only
  BEFORE UPDATE ON "inspection_report_summaries"
  FOR EACH ROW EXECUTE FUNCTION scrutiny_reject_update();

-- A checklist RESULT: only while the inspection is SCHEDULED, only by its
-- inspector, only for a checklist item of the application's own approval type,
-- and only citing evidence that belongs to this same inspection.
CREATE FUNCTION inspection_results_enforce() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  insp RECORD;
BEGIN
  SELECT i.status, i.inspector_id, a.approval_type_id INTO insp
    FROM inspections i JOIN approval_applications a ON a.id = i.application_id
   WHERE i.id = NEW.inspection_id;
  IF insp.status IS DISTINCT FROM 'SCHEDULED' THEN
    RAISE EXCEPTION 'inspection_reports: results can be recorded only while the inspection is scheduled'
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  IF NEW.recorded_by_user_id IS DISTINCT FROM insp.inspector_id THEN
    RAISE EXCEPTION 'inspection_reports: only the assigned inspector can record a result'
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM inspection_checklists c
                  WHERE c.id = NEW.checklist_item_id AND c.approval_type_id = insp.approval_type_id) THEN
    RAISE EXCEPTION 'inspection_reports: the checklist item does not belong to this application''s approval'
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  IF NEW.evidence_document_id IS NOT NULL AND NOT EXISTS (
       SELECT 1 FROM inspection_evidence e
        WHERE e.document_id = NEW.evidence_document_id AND e.inspection_id = NEW.inspection_id) THEN
    RAISE EXCEPTION 'inspection_reports: the evidence does not belong to this inspection'
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER inspection_results_integrity
  BEFORE INSERT ON "inspection_reports"
  FOR EACH ROW EXECUTE FUNCTION inspection_results_enforce();

-- EVIDENCE: only while SCHEDULED, only by the inspector, and only a document
-- that is scanned clean, in a usable state, and owned by the application's own
-- project (the same Step 9 rules that decide which documents can be served).
CREATE FUNCTION inspection_evidence_enforce() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  insp RECORD;
  doc  RECORD;
BEGIN
  SELECT i.status, i.inspector_id, a.project_id INTO insp
    FROM inspections i JOIN approval_applications a ON a.id = i.application_id
   WHERE i.id = NEW.inspection_id;
  IF insp.status IS DISTINCT FROM 'SCHEDULED' THEN
    RAISE EXCEPTION 'inspection_evidence: evidence can be attached only while the inspection is scheduled'
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  IF NEW.uploaded_by_user_id IS DISTINCT FROM insp.inspector_id THEN
    RAISE EXCEPTION 'inspection_evidence: only the assigned inspector can attach evidence'
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  SELECT d.scanned_at, d.status, d.owner_type, d.owner_id INTO doc
    FROM documents d WHERE d.id = NEW.document_id;
  IF doc.scanned_at IS NULL OR doc.status NOT IN ('VALIDATION_PENDING', 'VERIFIED') THEN
    RAISE EXCEPTION 'inspection_evidence: only a scanned, usable document can be evidence'
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  IF doc.owner_type IS DISTINCT FROM 'PROJECT' OR doc.owner_id IS DISTINCT FROM insp.project_id THEN
    RAISE EXCEPTION 'inspection_evidence: the document does not belong to this inspection''s project'
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER inspection_evidence_integrity
  BEFORE INSERT ON "inspection_evidence"
  FOR EACH ROW EXECUTE FUNCTION inspection_evidence_enforce();

-- The REPORT: only while SCHEDULED, only by the inspector, and only once every
-- checklist item of the approval has a recorded result.
CREATE FUNCTION inspection_report_summaries_enforce() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  insp RECORD;
BEGIN
  SELECT i.status, i.inspector_id, a.approval_type_id INTO insp
    FROM inspections i JOIN approval_applications a ON a.id = i.application_id
   WHERE i.id = NEW.inspection_id;
  IF insp.status IS DISTINCT FROM 'SCHEDULED' THEN
    RAISE EXCEPTION 'inspection_report_summaries: a report can be submitted only for a scheduled inspection'
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  IF NEW.submitted_by_user_id IS DISTINCT FROM insp.inspector_id THEN
    RAISE EXCEPTION 'inspection_report_summaries: only the assigned inspector can submit the report'
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  IF EXISTS (SELECT 1 FROM inspection_checklists c
              WHERE c.approval_type_id = insp.approval_type_id
                AND NOT EXISTS (SELECT 1 FROM inspection_reports r
                                 WHERE r.inspection_id = NEW.inspection_id
                                   AND r.checklist_item_id = c.id)) THEN
    RAISE EXCEPTION 'inspection_report_summaries: every checklist item needs a recorded result'
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER inspection_report_summaries_integrity
  BEFORE INSERT ON "inspection_report_summaries"
  FOR EACH ROW EXECUTE FUNCTION inspection_report_summaries_enforce();
