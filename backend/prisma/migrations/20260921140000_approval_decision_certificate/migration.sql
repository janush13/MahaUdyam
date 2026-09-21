-- Step 15: approval decision + certificate.
--
-- FRD 4.5 / TRD 3.2 / TRD 28 / Blueprint 20.2: the Approving Authority's
-- statutory decision (one per application, append-only, consuming - never
-- editing - the scrutiny recommendation), and the record of the issued approval
-- certificate (TRD 3.1 "Certificate Issuance"). The requirements define no
-- certificate format, numbering, validity period or e-sign, so none is modelled:
-- the certificate FILE is an ordinary Step 9 document and the number is
-- optional free text. No statutory data is seeded. The tables are new and empty.
-- CreateEnum
CREATE TYPE "decision_outcome" AS ENUM ('APPROVE', 'REJECT');

-- CreateTable
CREATE TABLE "approval_decisions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "application_id" UUID NOT NULL,
    "department_id" UUID NOT NULL,
    "recommendation_id" UUID NOT NULL,
    "outcome" "decision_outcome" NOT NULL,
    "reason" TEXT NOT NULL,
    "decided_by_user_id" UUID NOT NULL,
    "decided_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "approval_decisions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "approval_certificates" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "application_id" UUID NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "decision_id" UUID NOT NULL,
    "department_id" UUID NOT NULL,
    "certificate_number" TEXT,
    "document_id" UUID NOT NULL,
    "issued_by_user_id" UUID NOT NULL,
    "issued_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "approval_certificates_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "approval_decisions_application_id_key" ON "approval_decisions"("application_id");

-- CreateIndex
CREATE UNIQUE INDEX "approval_decisions_recommendation_id_key" ON "approval_decisions"("recommendation_id");

-- CreateIndex
CREATE UNIQUE INDEX "approval_certificates_document_id_key" ON "approval_certificates"("document_id");

-- CreateIndex
CREATE INDEX "approval_certificates_decision_id_idx" ON "approval_certificates"("decision_id");

-- CreateIndex
CREATE UNIQUE INDEX "approval_certificates_application_id_version_key" ON "approval_certificates"("application_id", "version");

-- AddForeignKey
ALTER TABLE "approval_decisions" ADD CONSTRAINT "approval_decisions_application_id_fkey" FOREIGN KEY ("application_id") REFERENCES "approval_applications"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approval_decisions" ADD CONSTRAINT "approval_decisions_department_id_fkey" FOREIGN KEY ("department_id") REFERENCES "departments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approval_decisions" ADD CONSTRAINT "approval_decisions_recommendation_id_fkey" FOREIGN KEY ("recommendation_id") REFERENCES "scrutiny_recommendations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approval_decisions" ADD CONSTRAINT "approval_decisions_decided_by_user_id_fkey" FOREIGN KEY ("decided_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approval_certificates" ADD CONSTRAINT "approval_certificates_application_id_fkey" FOREIGN KEY ("application_id") REFERENCES "approval_applications"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approval_certificates" ADD CONSTRAINT "approval_certificates_decision_id_fkey" FOREIGN KEY ("decision_id") REFERENCES "approval_decisions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approval_certificates" ADD CONSTRAINT "approval_certificates_department_id_fkey" FOREIGN KEY ("department_id") REFERENCES "departments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approval_certificates" ADD CONSTRAINT "approval_certificates_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "documents"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approval_certificates" ADD CONSTRAINT "approval_certificates_issued_by_user_id_fkey" FOREIGN KEY ("issued_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ---------------------------------------------------------------------------
-- Integrity enforced by PostgreSQL itself (not only by service code)
-- ---------------------------------------------------------------------------

ALTER TABLE "approval_decisions"
  ADD CONSTRAINT "approval_decisions_reason_check" CHECK (length(btrim("reason")) > 0);
ALTER TABLE "approval_certificates"
  ADD CONSTRAINT "approval_certificates_shape_check" CHECK (
    "version" >= 1
    AND ("certificate_number" IS NULL OR length(btrim("certificate_number")) > 0)
  );

-- Decisions and certificates are history: never edited (a later, defined
-- correction step would add new rows, not rewrite these).
CREATE OR REPLACE FUNCTION approval_records_reject_update() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '%: records are append-only and cannot be edited', TG_TABLE_NAME
    USING ERRCODE = 'integrity_constraint_violation';
END $$;

CREATE TRIGGER approval_decisions_append_only
  BEFORE UPDATE ON "approval_decisions"
  FOR EACH ROW EXECUTE FUNCTION approval_records_reject_update();
CREATE TRIGGER approval_certificates_append_only
  BEFORE UPDATE ON "approval_certificates"
  FOR EACH ROW EXECUTE FUNCTION approval_records_reject_update();

-- A DECISION exists only for an application that is RECOMMENDED_FOR_APPROVAL,
-- in the application's own department, answering the LATEST recommendation on
-- that same application.
CREATE OR REPLACE FUNCTION approval_decisions_enforce() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  app RECORD;
  rec RECORD;
BEGIN
  SELECT a.internal_state, t.department_id INTO app
    FROM approval_applications a
    JOIN approval_types t ON t.id = a.approval_type_id
   WHERE a.id = NEW.application_id;
  IF app.internal_state IS DISTINCT FROM 'RECOMMENDED_FOR_APPROVAL' THEN
    RAISE EXCEPTION 'approval_decisions: a decision can be recorded only for a recommended application'
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  IF NEW.department_id IS DISTINCT FROM app.department_id THEN
    RAISE EXCEPTION 'approval_decisions: the decision must be in the application''s own department'
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  SELECT r.application_id, r.created_at, r.id INTO rec
    FROM scrutiny_recommendations r WHERE r.id = NEW.recommendation_id;
  IF rec.application_id IS DISTINCT FROM NEW.application_id THEN
    RAISE EXCEPTION 'approval_decisions: the recommendation belongs to another application'
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  IF EXISTS (
    SELECT 1 FROM scrutiny_recommendations r2
     WHERE r2.application_id = NEW.application_id
       AND (r2.created_at, r2.id) > (rec.created_at, rec.id)
  ) THEN
    RAISE EXCEPTION 'approval_decisions: the decision must answer the latest recommendation'
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER approval_decisions_integrity
  BEFORE INSERT ON "approval_decisions"
  FOR EACH ROW EXECUTE FUNCTION approval_decisions_enforce();

-- A CERTIFICATE exists only for an APPROVED application, answering that
-- application's APPROVING decision, in its own department, with a scanned,
-- usable file owned by its project.
CREATE OR REPLACE FUNCTION approval_certificates_enforce() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  app RECORD;
  dec RECORD;
  doc RECORD;
BEGIN
  SELECT a.internal_state, a.project_id, t.department_id INTO app
    FROM approval_applications a
    JOIN approval_types t ON t.id = a.approval_type_id
   WHERE a.id = NEW.application_id;
  IF app.internal_state IS DISTINCT FROM 'APPROVED' THEN
    RAISE EXCEPTION 'approval_certificates: a certificate can be recorded only for an approved application'
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  IF NEW.department_id IS DISTINCT FROM app.department_id THEN
    RAISE EXCEPTION 'approval_certificates: the certificate must be in the application''s own department'
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  SELECT d.application_id, d.outcome INTO dec
    FROM approval_decisions d WHERE d.id = NEW.decision_id;
  IF dec.application_id IS DISTINCT FROM NEW.application_id
     OR dec.outcome IS DISTINCT FROM 'APPROVE' THEN
    RAISE EXCEPTION 'approval_certificates: a certificate answers the application''s approving decision'
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  SELECT d.scanned_at, d.status, d.owner_type, d.owner_id INTO doc
    FROM documents d WHERE d.id = NEW.document_id;
  IF doc.scanned_at IS NULL OR doc.status NOT IN ('VALIDATION_PENDING', 'VERIFIED') THEN
    RAISE EXCEPTION 'approval_certificates: only a scanned, usable document can be a certificate'
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  IF doc.owner_type IS DISTINCT FROM 'PROJECT' OR doc.owner_id IS DISTINCT FROM app.project_id THEN
    RAISE EXCEPTION 'approval_certificates: the document does not belong to this application''s project'
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER approval_certificates_integrity
  BEFORE INSERT ON "approval_certificates"
  FOR EACH ROW EXECUTE FUNCTION approval_certificates_enforce();

-- No arbitrary status: an application enters APPROVED / REJECTED only from
-- RECOMMENDED_FOR_APPROVAL AND only with the matching decision on record, and
-- enters CERTIFICATE_ISSUED only from APPROVED with its certificate on record.
-- (ACTIVE is deliberately not gated here: the compliance calendar's own tests
-- and jobs already treat it as a plain state.)
CREATE OR REPLACE FUNCTION approval_applications_enforce_decision_states() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.internal_state IS NOT DISTINCT FROM OLD.internal_state THEN
    RETURN NEW;
  END IF;
  IF NEW.internal_state IN ('APPROVED', 'REJECTED') THEN
    IF OLD.internal_state IS DISTINCT FROM 'RECOMMENDED_FOR_APPROVAL'
       OR NOT EXISTS (
         SELECT 1 FROM approval_decisions d
          WHERE d.application_id = NEW.id
            AND d.outcome = (CASE WHEN NEW.internal_state = 'APPROVED'
                                  THEN 'APPROVE' ELSE 'REJECT' END)::decision_outcome
       ) THEN
      RAISE EXCEPTION 'approval_applications: % requires a recommended application and the matching decision', NEW.internal_state
        USING ERRCODE = 'integrity_constraint_violation';
    END IF;
  ELSIF NEW.internal_state = 'CERTIFICATE_ISSUED' THEN
    IF OLD.internal_state IS DISTINCT FROM 'APPROVED'
       OR NOT EXISTS (SELECT 1 FROM approval_certificates c WHERE c.application_id = NEW.id) THEN
      RAISE EXCEPTION 'approval_applications: CERTIFICATE_ISSUED requires an approved application and its certificate'
        USING ERRCODE = 'integrity_constraint_violation';
    END IF;
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER approval_applications_decision_states
  BEFORE UPDATE ON "approval_applications"
  FOR EACH ROW EXECUTE FUNCTION approval_applications_enforce_decision_states();

-- The decision record on the application row is permanent once set. This
-- REPLACES the Step 9 function body with the identical rules plus that one
-- clause (the earlier migration file is untouched).
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
     OR (OLD.submitted_documents IS NOT NULL AND NEW.submitted_documents IS DISTINCT FROM OLD.submitted_documents)
     OR (OLD.decided_at IS NOT NULL AND NEW.decided_at IS DISTINCT FROM OLD.decided_at)
     OR (OLD.decision_reason IS NOT NULL AND NEW.decision_reason IS DISTINCT FROM OLD.decision_reason) THEN
    RAISE EXCEPTION 'approval_applications: reference number, submission record and decision record are permanent once set'
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN NEW;
END $$;
