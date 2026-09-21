-- Step 7: Approval discovery + deterministic rule engine.
--
-- Rules: add an ordering priority and an evidence/source reference, and make
-- (approval_type_id, version) unique so versions are strictly sequential.
-- Snapshots: make each discovery result self-contained and reproducible.
-- Both tables get database-level immutability, so "history is never
-- rewritten" is enforced by PostgreSQL itself and not only by application
-- code. No statutory data (approval types, rules, thresholds) is seeded.

-- AlterTable: approval_rules
-- `source_reference` is mandatory. A temporary default backfills any existing
-- rows with the explicit unknown marker `TBD` (never a guessed citation), then
-- is dropped so every new rule must state its source.
ALTER TABLE "approval_rules" ADD COLUMN     "priority" INTEGER NOT NULL DEFAULT 100,
ADD COLUMN     "source_reference" TEXT NOT NULL DEFAULT 'TBD';
ALTER TABLE "approval_rules" ALTER COLUMN "source_reference" DROP DEFAULT;

-- AlterTable: discovery_snapshots (temporary defaults only to backfill any
-- pre-existing rows; dropped immediately after).
ALTER TABLE "discovery_snapshots" ADD COLUMN     "created_by_user_id" UUID,
ADD COLUMN     "engine_version" TEXT NOT NULL DEFAULT 'unknown',
ADD COLUMN     "project_inputs" JSONB NOT NULL DEFAULT '{}',
ADD COLUMN     "result" JSONB NOT NULL DEFAULT '{}';
ALTER TABLE "discovery_snapshots" ALTER COLUMN "engine_version" DROP DEFAULT,
ALTER COLUMN "project_inputs" DROP DEFAULT,
ALTER COLUMN "result" DROP DEFAULT;

-- CreateIndex
CREATE UNIQUE INDEX "approval_rules_approval_type_id_version_key" ON "approval_rules"("approval_type_id", "version");

-- AddForeignKey
ALTER TABLE "discovery_snapshots" ADD CONSTRAINT "discovery_snapshots_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Immutability: a published rule version's definition can never change. Only
-- `is_active` (retiring / re-enabling) and a ONE-TIME `effective_to` (end
-- dating) may be updated; anything else means "publish a new version".
CREATE FUNCTION approval_rules_enforce_immutability() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.approval_type_id IS DISTINCT FROM OLD.approval_type_id
     OR NEW.version IS DISTINCT FROM OLD.version
     OR NEW.effective_from IS DISTINCT FROM OLD.effective_from
     OR NEW.is_officially_required IS DISTINCT FROM OLD.is_officially_required
     OR NEW.conditions IS DISTINCT FROM OLD.conditions
     OR NEW.excludes_if IS DISTINCT FROM OLD.excludes_if
     OR NEW.priority IS DISTINCT FROM OLD.priority
     OR NEW.source_reference IS DISTINCT FROM OLD.source_reference
     OR NEW.created_by IS DISTINCT FROM OLD.created_by
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'approval_rules: a published rule version is immutable; publish a new version instead'
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  IF OLD.effective_to IS NOT NULL AND NEW.effective_to IS DISTINCT FROM OLD.effective_to THEN
    RAISE EXCEPTION 'approval_rules: effective_to can only be set once'
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER approval_rules_immutable
  BEFORE UPDATE ON "approval_rules"
  FOR EACH ROW EXECUTE FUNCTION approval_rules_enforce_immutability();

-- Immutability: a discovery snapshot is a historical record; it is never
-- updated after being written.
CREATE FUNCTION discovery_snapshots_reject_update() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'discovery_snapshots: snapshots are immutable historical records'
    USING ERRCODE = 'integrity_constraint_violation';
END $$;

CREATE TRIGGER discovery_snapshots_immutable
  BEFORE UPDATE ON "discovery_snapshots"
  FOR EACH ROW EXECUTE FUNCTION discovery_snapshots_reject_update();
