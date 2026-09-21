-- Step 11A: Inspection foundation.
--
-- Links an inspection directly to its application (TRD 23: FK -> Application,
-- -> Officer), records who created it and who (re)assigned the inspector, and
-- makes the workflow-stage link optional (stages are instantiated by a later
-- step). No statutory data is seeded. The inspections table is empty and was
-- unreachable before this step, so the new NOT NULL columns need no back-fill.
-- DropIndex
DROP INDEX "inspections_inspector_id_idx";

-- AlterTable
ALTER TABLE "inspections" ADD COLUMN     "application_id" UUID NOT NULL,
ADD COLUMN     "assigned_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "assigned_by_user_id" UUID NOT NULL,
ADD COLUMN     "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "created_by_user_id" UUID NOT NULL,
ADD COLUMN     "updated_at" TIMESTAMP(3) NOT NULL,
ALTER COLUMN "application_stage_id" DROP NOT NULL;

-- CreateIndex
CREATE INDEX "inspections_inspector_id_status_idx" ON "inspections"("inspector_id", "status");

-- CreateIndex
CREATE INDEX "inspections_application_id_created_at_idx" ON "inspections"("application_id", "created_at");

-- AddForeignKey
ALTER TABLE "inspections" ADD CONSTRAINT "inspections_application_id_fkey" FOREIGN KEY ("application_id") REFERENCES "approval_applications"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inspections" ADD CONSTRAINT "inspections_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inspections" ADD CONSTRAINT "inspections_assigned_by_user_id_fkey" FOREIGN KEY ("assigned_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;



-- ---------------------------------------------------------------------------
-- Integrity enforced by PostgreSQL itself (not only by service code)
-- ---------------------------------------------------------------------------

ALTER TABLE "inspections"
  ADD CONSTRAINT "inspections_site_address_check"
    CHECK (length(btrim("site_address")) > 0),
  -- Status is derived from the schedule: PENDING has none, SCHEDULED has one.
  -- COMPLETED / CANCELLED are written by a later step and keep whatever
  -- schedule the inspection had.
  ADD CONSTRAINT "inspections_status_schedule_check" CHECK (
    ("status" = 'PENDING' AND "scheduled_at" IS NULL)
    OR ("status" = 'SCHEDULED' AND "scheduled_at" IS NOT NULL)
    OR "status" IN ('COMPLETED', 'CANCELLED')
  );

-- At most ONE open (PENDING / SCHEDULED) inspection per application: two
-- simultaneous requests for the same site visit cannot both win. A finished or
-- cancelled inspection does not block a further one (re-inspection).
CREATE UNIQUE INDEX "inspections_one_open_per_application_key"
  ON "inspections" ("application_id") WHERE "status" IN ('PENDING', 'SCHEDULED');

-- If a workflow stage is named it must be a stage of the SAME application, so
-- an inspection can never hang off another application's stage.
CREATE FUNCTION inspections_enforce_integrity() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.application_stage_id IS NOT NULL AND NOT EXISTS (
       SELECT 1 FROM application_stages s
        WHERE s.id = NEW.application_stage_id AND s.application_id = NEW.application_id) THEN
    RAISE EXCEPTION 'inspections: the workflow stage does not belong to the inspection''s application'
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  IF TG_OP = 'UPDATE' THEN
    -- Which application, who created it and when are fixed at creation.
    IF NEW.id IS DISTINCT FROM OLD.id
       OR NEW.application_id IS DISTINCT FROM OLD.application_id
       OR NEW.created_by_user_id IS DISTINCT FROM OLD.created_by_user_id
       OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
      RAISE EXCEPTION 'inspections: the application, creator and creation time are immutable'
        USING ERRCODE = 'integrity_constraint_violation';
    END IF;
    -- A finished / cancelled inspection is a historical record.
    IF OLD.status IN ('COMPLETED', 'CANCELLED') THEN
      RAISE EXCEPTION 'inspections: a % inspection is permanent', OLD.status
        USING ERRCODE = 'integrity_constraint_violation';
    END IF;
    -- A schedule, once set, can be moved but never un-set.
    IF OLD.status = 'SCHEDULED' AND NEW.status = 'PENDING' THEN
      RAISE EXCEPTION 'inspections: a scheduled inspection cannot go back to pending'
        USING ERRCODE = 'integrity_constraint_violation';
    END IF;
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER inspections_integrity
  BEFORE INSERT OR UPDATE ON "inspections"
  FOR EACH ROW EXECUTE FUNCTION inspections_enforce_integrity();
