-- Step 12: SLA management.
--
-- TRD 12 / Blueprint 23: the clock of an application stage (an SLA instance),
-- its pause history (one row per pause period) and the working-day holiday
-- calendar. The DEFINITION of a timeline stays on workflow_stages.sla_days,
-- NULL until a department configures it - nothing is seeded, no duration is
-- ever defaulted (FRD 25.3 / Blueprint 23.4). An instance snapshots the
-- configuration it started under, so a later change never re-times an existing
-- application. The new tables are empty; nothing needs back-filling.
-- CreateEnum
CREATE TYPE "sla_status" AS ENUM ('NOT_CONFIGURED', 'RUNNING', 'PAUSED', 'COMPLETED');

-- CreateEnum
CREATE TYPE "sla_pause_reason" AS ENUM ('QUERY_AWAITING_APPLICANT');

-- CreateTable
CREATE TABLE "sla_instances" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "application_id" UUID NOT NULL,
    "application_stage_id" UUID NOT NULL,
    "status" "sla_status" NOT NULL,
    "started_at" TIMESTAMP(3) NOT NULL,
    "sla_days" INTEGER,
    "pause_on_query" BOOLEAN NOT NULL,
    "original_due_at" TIMESTAMP(3),
    "due_at" TIMESTAMP(3),
    "paused_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    "breached_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sla_instances_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sla_pauses" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "sla_instance_id" UUID NOT NULL,
    "reason" "sla_pause_reason" NOT NULL,
    "query_id" UUID NOT NULL,
    "paused_at" TIMESTAMP(3) NOT NULL,
    "resumed_at" TIMESTAMP(3),

    CONSTRAINT "sla_pauses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sla_holidays" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "department_id" UUID,
    "holiday_date" DATE NOT NULL,
    "description" TEXT NOT NULL,
    "created_by_user_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sla_holidays_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "sla_instances_application_stage_id_key" ON "sla_instances"("application_stage_id");

-- CreateIndex
CREATE INDEX "sla_instances_application_id_idx" ON "sla_instances"("application_id");

-- CreateIndex
CREATE INDEX "sla_instances_status_due_at_idx" ON "sla_instances"("status", "due_at");

-- CreateIndex
CREATE UNIQUE INDEX "sla_pauses_query_id_key" ON "sla_pauses"("query_id");

-- CreateIndex
CREATE INDEX "sla_pauses_sla_instance_id_idx" ON "sla_pauses"("sla_instance_id");

-- CreateIndex
CREATE INDEX "sla_holidays_holiday_date_idx" ON "sla_holidays"("holiday_date");

-- CreateIndex
CREATE UNIQUE INDEX "sla_holidays_department_id_holiday_date_key" ON "sla_holidays"("department_id", "holiday_date");

-- CreateIndex
CREATE UNIQUE INDEX "application_stages_application_id_workflow_stage_id_key" ON "application_stages"("application_id", "workflow_stage_id");

-- AddForeignKey
ALTER TABLE "sla_instances" ADD CONSTRAINT "sla_instances_application_id_fkey" FOREIGN KEY ("application_id") REFERENCES "approval_applications"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sla_instances" ADD CONSTRAINT "sla_instances_application_stage_id_fkey" FOREIGN KEY ("application_stage_id") REFERENCES "application_stages"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sla_pauses" ADD CONSTRAINT "sla_pauses_sla_instance_id_fkey" FOREIGN KEY ("sla_instance_id") REFERENCES "sla_instances"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sla_pauses" ADD CONSTRAINT "sla_pauses_query_id_fkey" FOREIGN KEY ("query_id") REFERENCES "application_queries"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sla_holidays" ADD CONSTRAINT "sla_holidays_department_id_fkey" FOREIGN KEY ("department_id") REFERENCES "departments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sla_holidays" ADD CONSTRAINT "sla_holidays_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;



-- ---------------------------------------------------------------------------
-- Integrity enforced by PostgreSQL itself (not only by service code)
-- ---------------------------------------------------------------------------

-- A configured duration is a positive number of working days.
ALTER TABLE "workflow_stages"
  ADD CONSTRAINT "workflow_stages_sla_days_check"
    CHECK ("sla_days" IS NULL OR "sla_days" > 0);

ALTER TABLE "sla_instances"
  ADD CONSTRAINT "sla_instances_config_check" CHECK (
    ("sla_days" IS NULL) = ("original_due_at" IS NULL)
    AND ("sla_days" IS NULL) = ("due_at" IS NULL)
    AND ("sla_days" IS NULL OR "sla_days" > 0)
    AND ("status" <> 'NOT_CONFIGURED' OR "sla_days" IS NULL)
    AND ("status" NOT IN ('RUNNING', 'PAUSED') OR "sla_days" IS NOT NULL)
    AND ("due_at" IS NULL OR "due_at" >= "original_due_at")
  ),
  ADD CONSTRAINT "sla_instances_state_check" CHECK (
    ("status" = 'PAUSED') = ("paused_at" IS NOT NULL)
    AND ("status" = 'COMPLETED') = ("completed_at" IS NOT NULL)
    AND ("status" <> 'PAUSED' OR "pause_on_query")
    AND ("breached_at" IS NULL OR "breached_at" >= "started_at")
  );

-- The clock's lifecycle:
--   born NOT_CONFIGURED (no timeline configured) or RUNNING;
--   RUNNING -> PAUSED | COMPLETED, PAUSED -> RUNNING, NOT_CONFIGURED ->
--   COMPLETED, and nothing else (a completed clock is permanent);
--   what it started under (application, stage, start, snapshot, original due)
--   never changes; the deadline never moves earlier; a recorded breach is never
--   cleared or rewritten.
CREATE FUNCTION sla_instances_enforce() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (
       SELECT 1 FROM application_stages s
        WHERE s.id = NEW.application_stage_id AND s.application_id = NEW.application_id) THEN
    RAISE EXCEPTION 'sla_instances: the stage does not belong to the application'
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.status NOT IN ('NOT_CONFIGURED', 'RUNNING')
       OR NEW.paused_at IS NOT NULL OR NEW.completed_at IS NOT NULL
       OR NEW.breached_at IS NOT NULL
       OR NEW.due_at IS DISTINCT FROM NEW.original_due_at THEN
      RAISE EXCEPTION 'sla_instances: a clock starts NOT_CONFIGURED or RUNNING, unpaused and with its original deadline'
        USING ERRCODE = 'integrity_constraint_violation';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.application_id IS DISTINCT FROM OLD.application_id
     OR NEW.application_stage_id IS DISTINCT FROM OLD.application_stage_id
     OR NEW.started_at IS DISTINCT FROM OLD.started_at
     OR NEW.sla_days IS DISTINCT FROM OLD.sla_days
     OR NEW.pause_on_query IS DISTINCT FROM OLD.pause_on_query
     OR NEW.original_due_at IS DISTINCT FROM OLD.original_due_at
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'sla_instances: what a clock started under is immutable'
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  IF OLD.status = 'COMPLETED' THEN
    RAISE EXCEPTION 'sla_instances: a completed clock is permanent'
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  IF NEW.status IS DISTINCT FROM OLD.status
     AND NOT ((OLD.status = 'RUNNING' AND NEW.status IN ('PAUSED', 'COMPLETED'))
              OR (OLD.status = 'PAUSED' AND NEW.status = 'RUNNING')
              OR (OLD.status = 'NOT_CONFIGURED' AND NEW.status = 'COMPLETED')) THEN
    RAISE EXCEPTION 'sla_instances: invalid status transition % -> %', OLD.status, NEW.status
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  IF NEW.due_at IS DISTINCT FROM OLD.due_at AND NEW.due_at < OLD.due_at THEN
    RAISE EXCEPTION 'sla_instances: a deadline never moves earlier'
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  IF OLD.breached_at IS NOT NULL AND NEW.breached_at IS DISTINCT FROM OLD.breached_at THEN
    RAISE EXCEPTION 'sla_instances: a recorded breach is never cleared or rewritten'
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER sla_instances_integrity
  BEFORE INSERT OR UPDATE ON "sla_instances"
  FOR EACH ROW EXECUTE FUNCTION sla_instances_enforce();

-- Pauses: at most one in force per clock, a resume never precedes its pause,
-- and a pause belongs to a RUNNING clock that is configured to pause, caused by
-- a query of the SAME application.
ALTER TABLE "sla_pauses"
  ADD CONSTRAINT "sla_pauses_period_check"
    CHECK ("resumed_at" IS NULL OR "resumed_at" >= "paused_at");
CREATE UNIQUE INDEX "sla_pauses_one_open_per_instance"
  ON "sla_pauses"("sla_instance_id") WHERE "resumed_at" IS NULL;

CREATE FUNCTION sla_pauses_enforce() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  inst RECORD;
BEGIN
  IF TG_OP = 'INSERT' THEN
    SELECT i.status, i.pause_on_query, i.application_id, i.started_at INTO inst
      FROM sla_instances i WHERE i.id = NEW.sla_instance_id;
    IF inst.status IS DISTINCT FROM 'RUNNING' OR NOT inst.pause_on_query THEN
      RAISE EXCEPTION 'sla_pauses: only a running clock that is configured to pause can be paused'
        USING ERRCODE = 'integrity_constraint_violation';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM application_queries q
                    WHERE q.id = NEW.query_id AND q.application_id = inst.application_id) THEN
      RAISE EXCEPTION 'sla_pauses: the query does not belong to the clock''s application'
        USING ERRCODE = 'integrity_constraint_violation';
    END IF;
    IF NEW.resumed_at IS NOT NULL OR NEW.paused_at < inst.started_at THEN
      RAISE EXCEPTION 'sla_pauses: a pause starts open, after the clock started'
        USING ERRCODE = 'integrity_constraint_violation';
    END IF;
    RETURN NEW;
  END IF;
  -- UPDATE: the only change ever allowed is the one-time resume.
  IF OLD.resumed_at IS NOT NULL
     OR NEW.resumed_at IS NULL
     OR NEW.id IS DISTINCT FROM OLD.id
     OR NEW.sla_instance_id IS DISTINCT FROM OLD.sla_instance_id
     OR NEW.reason IS DISTINCT FROM OLD.reason
     OR NEW.query_id IS DISTINCT FROM OLD.query_id
     OR NEW.paused_at IS DISTINCT FROM OLD.paused_at THEN
    RAISE EXCEPTION 'sla_pauses: a pause is history; it can only be resumed, once'
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER sla_pauses_integrity
  BEFORE INSERT OR UPDATE ON "sla_pauses"
  FOR EACH ROW EXECUTE FUNCTION sla_pauses_enforce();

-- Holidays: one entry per date per calendar (a NULL department = state-wide is
-- not covered by the composite unique index), never blank, never edited (a
-- correction is a delete and a new entry).
CREATE UNIQUE INDEX "sla_holidays_statewide_date_key"
  ON "sla_holidays"("holiday_date") WHERE "department_id" IS NULL;
ALTER TABLE "sla_holidays"
  ADD CONSTRAINT "sla_holidays_description_check" CHECK (length(btrim("description")) > 0);
CREATE TRIGGER sla_holidays_append_only
  BEFORE UPDATE ON "sla_holidays"
  FOR EACH ROW EXECUTE FUNCTION scrutiny_reject_update();
