-- Step 10: Officer workspace + application scrutiny.
--
-- Adds assignments (with history), internal scrutiny observations, the query /
-- response record and scrutiny recommendations, plus the review verdict on
-- document_verifications. No statutory data is seeded. The tables are empty and
-- unreachable before this step, so the NOT NULL verdict needs no back-fill.
-- CreateEnum
CREATE TYPE "query_status" AS ENUM ('OPEN', 'RESPONDED', 'CLOSED');

-- CreateEnum
CREATE TYPE "recommended_outcome" AS ENUM ('APPROVE', 'REJECT');

-- CreateEnum
CREATE TYPE "document_verdict" AS ENUM ('VERIFIED', 'REJECTED');

-- AlterTable
ALTER TABLE "document_verifications" ADD COLUMN     "verdict" "document_verdict" NOT NULL;

-- CreateTable
CREATE TABLE "application_assignments" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "application_id" UUID NOT NULL,
    "department_id" UUID NOT NULL,
    "officer_user_id" UUID NOT NULL,
    "assigned_by_user_id" UUID NOT NULL,
    "assigned_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ended_at" TIMESTAMP(3),
    "ended_by_user_id" UUID,
    "end_reason" TEXT,

    CONSTRAINT "application_assignments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "scrutiny_observations" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "application_id" UUID NOT NULL,
    "department_id" UUID NOT NULL,
    "author_user_id" UUID NOT NULL,
    "body" TEXT NOT NULL,
    "related_document_id" UUID,
    "related_field" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "scrutiny_observations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "application_queries" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "application_id" UUID NOT NULL,
    "department_id" UUID NOT NULL,
    "round_number" INTEGER NOT NULL,
    "raised_by_user_id" UUID NOT NULL,
    "question" TEXT NOT NULL,
    "source_observation_id" UUID,
    "status" "query_status" NOT NULL DEFAULT 'OPEN',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "response_text" TEXT,
    "responded_by_user_id" UUID,
    "responded_at" TIMESTAMP(3),
    "closed_by_user_id" UUID,
    "closed_at" TIMESTAMP(3),

    CONSTRAINT "application_queries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "scrutiny_recommendations" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "application_id" UUID NOT NULL,
    "department_id" UUID NOT NULL,
    "outcome" "recommended_outcome" NOT NULL,
    "reason" TEXT NOT NULL,
    "recommended_by_user_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "scrutiny_recommendations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "application_assignments_application_id_idx" ON "application_assignments"("application_id");

-- CreateIndex
CREATE INDEX "application_assignments_officer_user_id_ended_at_idx" ON "application_assignments"("officer_user_id", "ended_at");

-- CreateIndex
CREATE INDEX "application_assignments_department_id_idx" ON "application_assignments"("department_id");

-- CreateIndex
CREATE INDEX "scrutiny_observations_application_id_created_at_idx" ON "scrutiny_observations"("application_id", "created_at");

-- CreateIndex
CREATE INDEX "application_queries_application_id_idx" ON "application_queries"("application_id");

-- CreateIndex
CREATE UNIQUE INDEX "application_queries_application_id_round_number_key" ON "application_queries"("application_id", "round_number");

-- CreateIndex
CREATE INDEX "scrutiny_recommendations_application_id_created_at_idx" ON "scrutiny_recommendations"("application_id", "created_at");

-- CreateIndex
CREATE INDEX "approval_applications_internal_state_submitted_at_idx" ON "approval_applications"("internal_state", "submitted_at");

-- CreateIndex
CREATE INDEX "audit_logs_entity_id_idx" ON "audit_logs"("entity_id");

-- AddForeignKey
ALTER TABLE "application_assignments" ADD CONSTRAINT "application_assignments_application_id_fkey" FOREIGN KEY ("application_id") REFERENCES "approval_applications"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "application_assignments" ADD CONSTRAINT "application_assignments_department_id_fkey" FOREIGN KEY ("department_id") REFERENCES "departments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "application_assignments" ADD CONSTRAINT "application_assignments_officer_user_id_fkey" FOREIGN KEY ("officer_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "application_assignments" ADD CONSTRAINT "application_assignments_assigned_by_user_id_fkey" FOREIGN KEY ("assigned_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "application_assignments" ADD CONSTRAINT "application_assignments_ended_by_user_id_fkey" FOREIGN KEY ("ended_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scrutiny_observations" ADD CONSTRAINT "scrutiny_observations_application_id_fkey" FOREIGN KEY ("application_id") REFERENCES "approval_applications"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scrutiny_observations" ADD CONSTRAINT "scrutiny_observations_department_id_fkey" FOREIGN KEY ("department_id") REFERENCES "departments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scrutiny_observations" ADD CONSTRAINT "scrutiny_observations_author_user_id_fkey" FOREIGN KEY ("author_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scrutiny_observations" ADD CONSTRAINT "scrutiny_observations_related_document_id_fkey" FOREIGN KEY ("related_document_id") REFERENCES "documents"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "application_queries" ADD CONSTRAINT "application_queries_application_id_fkey" FOREIGN KEY ("application_id") REFERENCES "approval_applications"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "application_queries" ADD CONSTRAINT "application_queries_department_id_fkey" FOREIGN KEY ("department_id") REFERENCES "departments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "application_queries" ADD CONSTRAINT "application_queries_raised_by_user_id_fkey" FOREIGN KEY ("raised_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "application_queries" ADD CONSTRAINT "application_queries_responded_by_user_id_fkey" FOREIGN KEY ("responded_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "application_queries" ADD CONSTRAINT "application_queries_closed_by_user_id_fkey" FOREIGN KEY ("closed_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "application_queries" ADD CONSTRAINT "application_queries_source_observation_id_fkey" FOREIGN KEY ("source_observation_id") REFERENCES "scrutiny_observations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scrutiny_recommendations" ADD CONSTRAINT "scrutiny_recommendations_application_id_fkey" FOREIGN KEY ("application_id") REFERENCES "approval_applications"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scrutiny_recommendations" ADD CONSTRAINT "scrutiny_recommendations_department_id_fkey" FOREIGN KEY ("department_id") REFERENCES "departments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scrutiny_recommendations" ADD CONSTRAINT "scrutiny_recommendations_recommended_by_user_id_fkey" FOREIGN KEY ("recommended_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ---------------------------------------------------------------------------
-- Integrity enforced by PostgreSQL itself (not only by service code)
-- ---------------------------------------------------------------------------

-- Assignment: at most ONE active (un-ended) assignment per application. Two
-- officers/admins racing to assign the same application cannot both win.
CREATE UNIQUE INDEX "application_assignments_one_active_key"
  ON "application_assignments" ("application_id") WHERE "ended_at" IS NULL;

ALTER TABLE "application_assignments"
  ADD CONSTRAINT "application_assignments_end_coherent_check"
  CHECK (("ended_at" IS NULL) = ("ended_by_user_id" IS NULL));

-- An assignment is history: who, what, when can never change; it can only be
-- ENDED (once). A reassignment ends this row and writes a new one.
CREATE FUNCTION application_assignments_enforce_immutability() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.application_id IS DISTINCT FROM OLD.application_id
     OR NEW.department_id IS DISTINCT FROM OLD.department_id
     OR NEW.officer_user_id IS DISTINCT FROM OLD.officer_user_id
     OR NEW.assigned_by_user_id IS DISTINCT FROM OLD.assigned_by_user_id
     OR NEW.assigned_at IS DISTINCT FROM OLD.assigned_at THEN
    RAISE EXCEPTION 'application_assignments: an assignment is a historical record; end it and create a new one'
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  IF OLD.ended_at IS NOT NULL
     AND (NEW.ended_at IS DISTINCT FROM OLD.ended_at
          OR NEW.ended_by_user_id IS DISTINCT FROM OLD.ended_by_user_id
          OR NEW.end_reason IS DISTINCT FROM OLD.end_reason) THEN
    RAISE EXCEPTION 'application_assignments: an ended assignment is permanent'
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER application_assignments_immutable
  BEFORE UPDATE ON "application_assignments"
  FOR EACH ROW EXECUTE FUNCTION application_assignments_enforce_immutability();

-- Append-only records: observations, recommendations and document reviews are
-- never edited ("corrections are new entries, never edits of history").
ALTER TABLE "scrutiny_observations"
  ADD CONSTRAINT "scrutiny_observations_body_check" CHECK (length(btrim("body")) > 0);
ALTER TABLE "scrutiny_recommendations"
  ADD CONSTRAINT "scrutiny_recommendations_reason_check" CHECK (length(btrim("reason")) > 0);

CREATE FUNCTION scrutiny_reject_update() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '%: records are append-only and cannot be edited', TG_TABLE_NAME
    USING ERRCODE = 'integrity_constraint_violation';
END $$;

CREATE TRIGGER scrutiny_observations_append_only
  BEFORE UPDATE ON "scrutiny_observations"
  FOR EACH ROW EXECUTE FUNCTION scrutiny_reject_update();
CREATE TRIGGER scrutiny_recommendations_append_only
  BEFORE UPDATE ON "scrutiny_recommendations"
  FOR EACH ROW EXECUTE FUNCTION scrutiny_reject_update();
CREATE TRIGGER document_verifications_append_only
  BEFORE UPDATE ON "document_verifications"
  FOR EACH ROW EXECUTE FUNCTION scrutiny_reject_update();

-- Queries: one un-closed query per application at a time, a coherent shape for
-- each state, and a strictly forward lifecycle OPEN -> RESPONDED -> CLOSED.
CREATE UNIQUE INDEX "application_queries_one_unclosed_key"
  ON "application_queries" ("application_id") WHERE "status" <> 'CLOSED';

ALTER TABLE "application_queries"
  ADD CONSTRAINT "application_queries_question_check" CHECK (length(btrim("question")) > 0),
  ADD CONSTRAINT "application_queries_round_check" CHECK ("round_number" >= 1),
  ADD CONSTRAINT "application_queries_state_shape_check" CHECK (
    ("status" = 'OPEN'
       AND "response_text" IS NULL AND "responded_at" IS NULL AND "responded_by_user_id" IS NULL
       AND "closed_at" IS NULL AND "closed_by_user_id" IS NULL)
    OR ("status" = 'RESPONDED'
       AND "response_text" IS NOT NULL AND "responded_at" IS NOT NULL AND "responded_by_user_id" IS NOT NULL
       AND "closed_at" IS NULL AND "closed_by_user_id" IS NULL)
    OR ("status" = 'CLOSED'
       AND "response_text" IS NOT NULL AND "responded_at" IS NOT NULL AND "responded_by_user_id" IS NOT NULL
       AND "closed_at" IS NOT NULL AND "closed_by_user_id" IS NOT NULL)
  );

-- What was asked, by whom, and when is fixed at creation; a response, once
-- given, is fixed too; the status only ever moves forward one step.
CREATE FUNCTION application_queries_enforce_immutability() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.application_id IS DISTINCT FROM OLD.application_id
     OR NEW.department_id IS DISTINCT FROM OLD.department_id
     OR NEW.round_number IS DISTINCT FROM OLD.round_number
     OR NEW.raised_by_user_id IS DISTINCT FROM OLD.raised_by_user_id
     OR NEW.question IS DISTINCT FROM OLD.question
     OR NEW.source_observation_id IS DISTINCT FROM OLD.source_observation_id
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'application_queries: a query and who raised it are immutable'
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  IF OLD.response_text IS NOT NULL
     AND (NEW.response_text IS DISTINCT FROM OLD.response_text
          OR NEW.responded_at IS DISTINCT FROM OLD.responded_at
          OR NEW.responded_by_user_id IS DISTINCT FROM OLD.responded_by_user_id) THEN
    RAISE EXCEPTION 'application_queries: a response is permanent once given'
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  IF OLD.closed_at IS NOT NULL
     AND (NEW.closed_at IS DISTINCT FROM OLD.closed_at
          OR NEW.closed_by_user_id IS DISTINCT FROM OLD.closed_by_user_id) THEN
    RAISE EXCEPTION 'application_queries: a closed query is permanent'
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  IF NOT (NEW.status = OLD.status
          OR (OLD.status = 'OPEN' AND NEW.status = 'RESPONDED')
          OR (OLD.status = 'RESPONDED' AND NEW.status = 'CLOSED')) THEN
    RAISE EXCEPTION 'application_queries: invalid status transition % -> %', OLD.status, NEW.status
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER application_queries_immutable
  BEFORE UPDATE ON "application_queries"
  FOR EACH ROW EXECUTE FUNCTION application_queries_enforce_immutability();
