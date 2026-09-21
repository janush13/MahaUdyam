-- Step 16: schemes / government support services.
--
-- FRD 29 / 34, TRD 15 / 23.2, Blueprint 12.7 / 13.9: the scheme catalogue (with
-- a draft -> published control), versioned eligibility rules, the scheme's
-- required documents, and scheme applications with the documented status set
-- APPLIED -> UNDER_REVIEW -> APPROVED | REJECTED -> DISBURSED plus the history
-- table TRD 23.2 asks for. The `schemes`, `scheme_rules` and
-- `scheme_applications` tables already existed (Step 2) but nothing has ever
-- written to them and nothing is seeded, so the guard below refuses to run if
-- that assumption is false rather than guess how to backfill. No scheme, rule,
-- threshold, benefit or deadline is created by this migration.

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "schemes")
     OR EXISTS (SELECT 1 FROM "scheme_rules")
     OR EXISTS (SELECT 1 FROM "scheme_applications") THEN
    RAISE EXCEPTION 'schemes migration: scheme tables are expected to be empty (nothing writes to them before this step)';
  END IF;
END $$;

-- CreateEnum
CREATE TYPE "scheme_application_status" AS ENUM ('APPLIED', 'UNDER_REVIEW', 'APPROVED', 'REJECTED', 'DISBURSED');

-- Reference numbers for scheme applications (like ENT- / PRJ-).
CREATE SEQUENCE "scheme_application_reference_seq" START 1;

-- AlterTable
ALTER TABLE "scheme_applications" ADD COLUMN     "catalogue_snapshot" JSONB NOT NULL,
ADD COLUMN     "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "created_by_user_id" UUID NOT NULL,
ADD COLUMN     "decided_by_user_id" UUID,
ADD COLUMN     "decision_reason" TEXT,
ADD COLUMN     "disbursed_at" TIMESTAMP(3),
ADD COLUMN     "updated_at" TIMESTAMP(3) NOT NULL,
ALTER COLUMN "workflow_id" DROP NOT NULL,
ALTER COLUMN "reference_number" SET DEFAULT ((('SCH-'::text || to_char(now(), 'YYYY'::text)) || '-'::text) || lpad((nextval('scheme_application_reference_seq'::regclass))::text, 6, '0'::text));

-- The free-text status becomes the explicit enum (TRD 23.2). A value outside the
-- enum would fail here, loudly, instead of being dropped.
ALTER TABLE "scheme_applications"
  ALTER COLUMN "status" TYPE "scheme_application_status" USING ("status"::"scheme_application_status"),
  ALTER COLUMN "status" SET DEFAULT 'APPLIED';

-- AlterTable
ALTER TABLE "scheme_rules" ADD COLUMN     "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "created_by_user_id" UUID NOT NULL,
ADD COLUMN     "priority" INTEGER NOT NULL DEFAULT 100,
ADD COLUMN     "source_reference" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "schemes" ADD COLUMN     "applicable_districts" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "applicable_enterprise_sizes" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "applicable_sectors" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "application_deadline" TIMESTAMP(3),
ADD COLUMN     "benefit_type" TEXT,
ADD COLUMN     "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "created_by_user_id" UUID NOT NULL,
ADD COLUMN     "eligibility_criteria" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "published_at" TIMESTAMP(3),
ADD COLUMN     "published_by_user_id" UUID,
ADD COLUMN     "source_reference" TEXT,
ADD COLUMN     "updated_at" TIMESTAMP(3) NOT NULL,
ADD COLUMN     "version" INTEGER NOT NULL DEFAULT 1;

-- CreateTable
CREATE TABLE "scheme_document_requirements" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "scheme_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "is_mandatory" BOOLEAN NOT NULL,
    "description" TEXT,
    "max_size_bytes" INTEGER,
    "allowed_mime_types" TEXT[] DEFAULT ARRAY[]::TEXT[],

    CONSTRAINT "scheme_document_requirements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "scheme_application_status_history" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "scheme_application_id" UUID NOT NULL,
    "from_status" "scheme_application_status",
    "to_status" "scheme_application_status" NOT NULL,
    "actor_user_id" UUID NOT NULL,
    "actor_role" TEXT NOT NULL,
    "reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "scheme_application_status_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "scheme_application_documents" (
    "scheme_application_id" UUID NOT NULL,
    "document_id" UUID NOT NULL,
    "scheme_document_requirement_id" UUID,

    CONSTRAINT "scheme_application_documents_pkey" PRIMARY KEY ("scheme_application_id","document_id")
);

-- CreateIndex
CREATE INDEX "scheme_document_requirements_scheme_id_idx" ON "scheme_document_requirements"("scheme_id");

-- CreateIndex
CREATE INDEX "scheme_application_status_history_scheme_application_id_cre_idx" ON "scheme_application_status_history"("scheme_application_id", "created_at");

-- CreateIndex
CREATE INDEX "scheme_application_documents_scheme_application_id_idx" ON "scheme_application_documents"("scheme_application_id");

-- CreateIndex
CREATE INDEX "scheme_application_documents_document_id_idx" ON "scheme_application_documents"("document_id");

-- CreateIndex
CREATE INDEX "scheme_application_documents_scheme_document_requirement_id_idx" ON "scheme_application_documents"("scheme_document_requirement_id");

-- CreateIndex
CREATE INDEX "scheme_applications_scheme_id_status_idx" ON "scheme_applications"("scheme_id", "status");

-- CreateIndex
CREATE INDEX "scheme_applications_project_id_idx" ON "scheme_applications"("project_id");

-- CreateIndex
CREATE UNIQUE INDEX "scheme_rules_scheme_id_version_key" ON "scheme_rules"("scheme_id", "version");

-- CreateIndex
CREATE INDEX "schemes_publish_status_is_active_idx" ON "schemes"("publish_status", "is_active");

-- AddForeignKey
ALTER TABLE "schemes" ADD CONSTRAINT "schemes_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "schemes" ADD CONSTRAINT "schemes_published_by_user_id_fkey" FOREIGN KEY ("published_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scheme_rules" ADD CONSTRAINT "scheme_rules_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scheme_document_requirements" ADD CONSTRAINT "scheme_document_requirements_scheme_id_fkey" FOREIGN KEY ("scheme_id") REFERENCES "schemes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scheme_applications" ADD CONSTRAINT "scheme_applications_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scheme_applications" ADD CONSTRAINT "scheme_applications_decided_by_user_id_fkey" FOREIGN KEY ("decided_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scheme_application_status_history" ADD CONSTRAINT "scheme_application_status_history_scheme_application_id_fkey" FOREIGN KEY ("scheme_application_id") REFERENCES "scheme_applications"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scheme_application_status_history" ADD CONSTRAINT "scheme_application_status_history_actor_user_id_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scheme_application_documents" ADD CONSTRAINT "scheme_application_documents_scheme_application_id_fkey" FOREIGN KEY ("scheme_application_id") REFERENCES "scheme_applications"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scheme_application_documents" ADD CONSTRAINT "scheme_application_documents_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scheme_application_documents" ADD CONSTRAINT "scheme_application_documents_scheme_document_requirement_i_fkey" FOREIGN KEY ("scheme_document_requirement_id") REFERENCES "scheme_document_requirements"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ---------------------------------------------------------------------------
-- Integrity enforced by PostgreSQL itself (not only by service code)
-- ---------------------------------------------------------------------------

ALTER TABLE "schemes"
  ADD CONSTRAINT "schemes_shape_check" CHECK (
    length(btrim("name")) > 0
    AND length(btrim("description")) > 0
    AND length(btrim("benefits")) > 0
    AND "version" >= 1
  );
ALTER TABLE "scheme_rules"
  ADD CONSTRAINT "scheme_rules_shape_check" CHECK (
    "version" >= 1
    AND "priority" >= 0
    AND length(btrim("source_reference")) > 0
    AND ("effective_to" IS NULL OR "effective_to" > "effective_from")
  );
ALTER TABLE "scheme_document_requirements"
  ADD CONSTRAINT "scheme_document_requirements_shape_check" CHECK (
    length(btrim("name")) > 0
    AND ("max_size_bytes" IS NULL OR "max_size_bytes" > 0)
  );

-- A scheme's CONTENT is frozen while it is published (FRD 34 "subject to a
-- publish/approval step"): what was approved is what applicants read. Activating
-- or deactivating it, and returning it to draft for revision, stay possible.
CREATE FUNCTION schemes_enforce() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.department_id IS DISTINCT FROM OLD.department_id
     OR NEW.created_by_user_id IS DISTINCT FROM OLD.created_by_user_id
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'schemes: identity, department and creator are immutable'
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  IF OLD.publish_status = 'PUBLISHED' AND NEW.publish_status = 'PUBLISHED'
     AND (NEW.name IS DISTINCT FROM OLD.name
       OR NEW.description IS DISTINCT FROM OLD.description
       OR NEW.benefits IS DISTINCT FROM OLD.benefits
       OR NEW.eligibility_criteria IS DISTINCT FROM OLD.eligibility_criteria
       OR NEW.benefit_type IS DISTINCT FROM OLD.benefit_type
       OR NEW.applicable_sectors IS DISTINCT FROM OLD.applicable_sectors
       OR NEW.applicable_districts IS DISTINCT FROM OLD.applicable_districts
       OR NEW.applicable_enterprise_sizes IS DISTINCT FROM OLD.applicable_enterprise_sizes
       OR NEW.application_deadline IS DISTINCT FROM OLD.application_deadline
       OR NEW.source_reference IS DISTINCT FROM OLD.source_reference
       OR NEW.version IS DISTINCT FROM OLD.version) THEN
    RAISE EXCEPTION 'schemes: a published scheme cannot be edited; return it to draft first'
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  IF OLD.publish_status = 'DRAFT' AND NEW.publish_status = 'PUBLISHED'
     AND (NEW.published_at IS NULL OR NEW.published_by_user_id IS NULL) THEN
    RAISE EXCEPTION 'schemes: publishing records who published it and when'
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER schemes_integrity
  BEFORE UPDATE ON "schemes"
  FOR EACH ROW EXECUTE FUNCTION schemes_enforce();

-- Rule versions are history: written once, and only for a DRAFT scheme (the rules
-- a published scheme was approved with cannot gain a new version underneath it).
CREATE FUNCTION scheme_rules_enforce() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  parent_status scheme_publish_status;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION 'scheme_rules: a rule version is immutable; publish a new version'
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  SELECT publish_status INTO parent_status FROM schemes WHERE id = NEW.scheme_id;
  IF parent_status IS DISTINCT FROM 'DRAFT' THEN
    RAISE EXCEPTION 'scheme_rules: rules can be added only to a draft scheme'
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER scheme_rules_integrity
  BEFORE INSERT OR UPDATE ON "scheme_rules"
  FOR EACH ROW EXECUTE FUNCTION scheme_rules_enforce();

-- Required documents belong to the scheme's approved content: added or edited
-- only while it is a draft, and never moved to another scheme.
CREATE FUNCTION scheme_document_requirements_enforce() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  parent_status scheme_publish_status;
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.scheme_id IS DISTINCT FROM OLD.scheme_id THEN
    RAISE EXCEPTION 'scheme_document_requirements: a requirement cannot move to another scheme'
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  SELECT publish_status INTO parent_status FROM schemes WHERE id = NEW.scheme_id;
  IF parent_status IS DISTINCT FROM 'DRAFT' THEN
    RAISE EXCEPTION 'scheme_document_requirements: requirements can change only while the scheme is a draft'
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER scheme_document_requirements_integrity
  BEFORE INSERT OR UPDATE ON "scheme_document_requirements"
  FOR EACH ROW EXECUTE FUNCTION scheme_document_requirements_enforce();

-- A scheme application starts APPLIED and moves ONLY along TRD 15's documented
-- transitions, each carrying what it must:
--   APPLIED      -> UNDER_REVIEW  (nothing else changes)
--   UNDER_REVIEW -> APPROVED | REJECTED  (who, when and a reason)
--   APPROVED     -> DISBURSED  (when)
-- Identity, the catalogue snapshot and the reference number never change.
CREATE FUNCTION scheme_applications_enforce() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'APPLIED'
       OR NEW.decided_at IS NOT NULL
       OR NEW.decided_by_user_id IS NOT NULL
       OR NEW.decision_reason IS NOT NULL
       OR NEW.disbursed_at IS NOT NULL THEN
      RAISE EXCEPTION 'scheme_applications: an application starts as APPLIED with no decision'
        USING ERRCODE = 'integrity_constraint_violation';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.scheme_id IS DISTINCT FROM OLD.scheme_id
     OR NEW.project_id IS DISTINCT FROM OLD.project_id
     OR NEW.workflow_id IS DISTINCT FROM OLD.workflow_id
     OR NEW.reference_number IS DISTINCT FROM OLD.reference_number
     OR NEW.submitted_at IS DISTINCT FROM OLD.submitted_at
     OR NEW.catalogue_snapshot IS DISTINCT FROM OLD.catalogue_snapshot
     OR NEW.created_by_user_id IS DISTINCT FROM OLD.created_by_user_id
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'scheme_applications: identity, reference, submission and catalogue snapshot are immutable'
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;

  IF NEW.status = OLD.status THEN
    IF NEW.decided_at IS DISTINCT FROM OLD.decided_at
       OR NEW.decided_by_user_id IS DISTINCT FROM OLD.decided_by_user_id
       OR NEW.decision_reason IS DISTINCT FROM OLD.decision_reason
       OR NEW.disbursed_at IS DISTINCT FROM OLD.disbursed_at THEN
      RAISE EXCEPTION 'scheme_applications: decision and disbursement change only with a status transition'
        USING ERRCODE = 'integrity_constraint_violation';
    END IF;
    RETURN NEW;
  END IF;

  IF OLD.status = 'APPLIED' AND NEW.status = 'UNDER_REVIEW' THEN
    IF NEW.decided_at IS DISTINCT FROM OLD.decided_at
       OR NEW.decided_by_user_id IS DISTINCT FROM OLD.decided_by_user_id
       OR NEW.decision_reason IS DISTINCT FROM OLD.decision_reason
       OR NEW.disbursed_at IS DISTINCT FROM OLD.disbursed_at THEN
      RAISE EXCEPTION 'scheme_applications: starting a review records no decision'
        USING ERRCODE = 'integrity_constraint_violation';
    END IF;
  ELSIF OLD.status = 'UNDER_REVIEW' AND NEW.status IN ('APPROVED', 'REJECTED') THEN
    IF NEW.decided_at IS NULL
       OR NEW.decided_by_user_id IS NULL
       OR NEW.decision_reason IS NULL
       OR length(btrim(NEW.decision_reason)) = 0
       OR NEW.disbursed_at IS NOT NULL THEN
      RAISE EXCEPTION 'scheme_applications: a decision records who, when and a reason'
        USING ERRCODE = 'integrity_constraint_violation';
    END IF;
  ELSIF OLD.status = 'APPROVED' AND NEW.status = 'DISBURSED' THEN
    IF NEW.disbursed_at IS NULL
       OR NEW.decided_at IS DISTINCT FROM OLD.decided_at
       OR NEW.decided_by_user_id IS DISTINCT FROM OLD.decided_by_user_id
       OR NEW.decision_reason IS DISTINCT FROM OLD.decision_reason THEN
      RAISE EXCEPTION 'scheme_applications: disbursement records when and keeps the decision'
        USING ERRCODE = 'integrity_constraint_violation';
    END IF;
  ELSE
    RAISE EXCEPTION 'scheme_applications: % -> % is not a defined transition', OLD.status, NEW.status
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER scheme_applications_integrity
  BEFORE INSERT OR UPDATE ON "scheme_applications"
  FOR EACH ROW EXECUTE FUNCTION scheme_applications_enforce();

-- The status history and the evidence links are written once.
CREATE FUNCTION scheme_records_reject_update() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '%: records are append-only and cannot be edited', TG_TABLE_NAME
    USING ERRCODE = 'integrity_constraint_violation';
END $$;

CREATE TRIGGER scheme_application_status_history_append_only
  BEFORE UPDATE ON "scheme_application_status_history"
  FOR EACH ROW EXECUTE FUNCTION scheme_records_reject_update();
CREATE TRIGGER scheme_application_documents_immutable
  BEFORE UPDATE ON "scheme_application_documents"
  FOR EACH ROW EXECUTE FUNCTION scheme_records_reject_update();

-- Evidence is attached to the right application: the document belongs to that
-- application's PROJECT, and a requirement it answers belongs to that
-- application's SCHEME.
CREATE FUNCTION scheme_application_documents_enforce() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  app RECORD;
  doc RECORD;
  req_scheme UUID;
BEGIN
  SELECT scheme_id, project_id INTO app FROM scheme_applications WHERE id = NEW.scheme_application_id;
  SELECT owner_type, owner_id INTO doc FROM documents WHERE id = NEW.document_id;
  IF app IS NULL OR doc IS NULL
     OR doc.owner_type <> 'PROJECT'
     OR doc.owner_id IS DISTINCT FROM app.project_id THEN
    RAISE EXCEPTION 'scheme_application_documents: the document must belong to the application''s project'
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  IF NEW.scheme_document_requirement_id IS NOT NULL THEN
    SELECT scheme_id INTO req_scheme FROM scheme_document_requirements
      WHERE id = NEW.scheme_document_requirement_id;
    IF req_scheme IS DISTINCT FROM app.scheme_id THEN
      RAISE EXCEPTION 'scheme_application_documents: the requirement must belong to the application''s scheme'
        USING ERRCODE = 'integrity_constraint_violation';
    END IF;
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER scheme_application_documents_integrity
  BEFORE INSERT ON "scheme_application_documents"
  FOR EACH ROW EXECUTE FUNCTION scheme_application_documents_enforce();
