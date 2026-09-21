-- Step 13: notifications.
--
-- FRD 26 / TRD 13 / Blueprint 12.9 + 24. The `notifications` table already
-- exists (init migration, never written to); this migration gives it what an
-- in-app notification centre needs: a title, a scoping audience, references to
-- the enterprise / project / application the notification is about, structured
-- non-sensitive facts (payload), a one-way read marker, a per-event dedupe key
-- (idempotent creation) and the retry bookkeeping of the optional EMAIL / SMS
-- mirrors. The table has never been written to, so the NOT NULL columns are
-- added with a temporary default and the default is dropped again; nothing else
-- needs back-filling.

-- CreateEnum
CREATE TYPE "notification_audience" AS ENUM ('APPLICANT', 'OFFICER', 'ACCOUNT');

-- AlterTable
ALTER TABLE "notifications" ADD COLUMN     "application_id" UUID,
ADD COLUMN     "audience" "notification_audience" NOT NULL DEFAULT 'ACCOUNT',
ADD COLUMN     "dedupe_key" TEXT NOT NULL DEFAULT gen_random_uuid()::text,
ADD COLUMN     "enterprise_id" UUID,
ADD COLUMN     "failure_reason" TEXT,
ADD COLUMN     "next_attempt_at" TIMESTAMP(3),
ADD COLUMN     "payload" JSONB,
ADD COLUMN     "project_id" UUID,
ADD COLUMN     "read_at" TIMESTAMP(3),
ADD COLUMN     "title" TEXT NOT NULL DEFAULT '';

ALTER TABLE "notifications"
  ALTER COLUMN "audience" DROP DEFAULT,
  ALTER COLUMN "dedupe_key" DROP DEFAULT,
  ALTER COLUMN "title" DROP DEFAULT;

-- CreateIndex
CREATE INDEX "notifications_user_id_created_at_idx" ON "notifications"("user_id", "created_at");

-- CreateIndex
CREATE INDEX "notifications_user_id_read_at_idx" ON "notifications"("user_id", "read_at");

-- CreateIndex
CREATE INDEX "notifications_channel_status_next_attempt_at_idx" ON "notifications"("channel", "status", "next_attempt_at");

-- CreateIndex
CREATE UNIQUE INDEX "notifications_user_id_channel_dedupe_key_key" ON "notifications"("user_id", "channel", "dedupe_key");

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_enterprise_id_fkey" FOREIGN KEY ("enterprise_id") REFERENCES "enterprises"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_application_id_fkey" FOREIGN KEY ("application_id") REFERENCES "approval_applications"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- ---------------------------------------------------------------------------
-- Integrity enforced by PostgreSQL itself (not only by service code)
-- ---------------------------------------------------------------------------

ALTER TABLE "notifications"
  ADD CONSTRAINT "notifications_content_check" CHECK (
    length(btrim("title")) > 0
    AND length(btrim("message")) > 0
    AND length("dedupe_key") > 0
    AND "attempt_count" >= 0
  ),
  -- Delivery state is coherent: a row that has been sent or read has a send
  -- time; one still to be delivered does not.
  ADD CONSTRAINT "notifications_state_check" CHECK (
    ("status" IN ('SENT', 'READ')) = ("sent_at" IS NOT NULL)
    AND ("status" = 'READ') = ("read_at" IS NOT NULL)
    AND ("read_at" IS NULL OR "channel" = 'IN_APP')
    AND ("status" <> 'READ' OR "channel" = 'IN_APP')
  );

-- The in-app row IS the delivery: it is born SENT (never PENDING, never read).
-- An EMAIL / SMS mirror is born PENDING. After that only delivery state and the
-- one-way read marker may change; what a notification SAYS, who it is for and
-- what it refers to never do. (A referenced enterprise / project / application
-- may be nulled by its foreign key, and by nothing else.)
CREATE FUNCTION notifications_enforce() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.channel = 'IN_APP' AND NEW.status <> 'SENT' THEN
      RAISE EXCEPTION 'notifications: an in-app notification is born SENT'
        USING ERRCODE = 'integrity_constraint_violation';
    END IF;
    IF NEW.channel <> 'IN_APP' AND NEW.status <> 'PENDING' THEN
      RAISE EXCEPTION 'notifications: an email / SMS notification is born PENDING'
        USING ERRCODE = 'integrity_constraint_violation';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.user_id IS DISTINCT FROM OLD.user_id
     OR NEW.event_type IS DISTINCT FROM OLD.event_type
     OR NEW.channel IS DISTINCT FROM OLD.channel
     OR NEW.audience IS DISTINCT FROM OLD.audience
     OR NEW.title IS DISTINCT FROM OLD.title
     OR NEW.message IS DISTINCT FROM OLD.message
     OR NEW.payload IS DISTINCT FROM OLD.payload
     OR NEW.dedupe_key IS DISTINCT FROM OLD.dedupe_key
     OR NEW.created_at IS DISTINCT FROM OLD.created_at
     OR (NEW.enterprise_id IS DISTINCT FROM OLD.enterprise_id AND NEW.enterprise_id IS NOT NULL)
     OR (NEW.project_id IS DISTINCT FROM OLD.project_id AND NEW.project_id IS NOT NULL)
     OR (NEW.application_id IS DISTINCT FROM OLD.application_id AND NEW.application_id IS NOT NULL) THEN
    RAISE EXCEPTION 'notifications: the content of a notification is immutable'
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  IF OLD.read_at IS NOT NULL
     AND (NEW.read_at IS DISTINCT FROM OLD.read_at OR NEW.status <> 'READ') THEN
    RAISE EXCEPTION 'notifications: a read notification stays read'
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  IF NEW.status IS DISTINCT FROM OLD.status
     AND NOT ((OLD.status = 'SENT' AND NEW.status = 'READ' AND NEW.channel = 'IN_APP')
              OR (OLD.status IN ('PENDING', 'FAILED') AND NEW.status IN ('SENT', 'FAILED')
                  AND NEW.channel <> 'IN_APP')) THEN
    RAISE EXCEPTION 'notifications: invalid status transition % -> %', OLD.status, NEW.status
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  IF NEW.attempt_count < OLD.attempt_count THEN
    RAISE EXCEPTION 'notifications: the attempt count never goes back'
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER notifications_integrity
  BEFORE INSERT OR UPDATE ON "notifications"
  FOR EACH ROW EXECUTE FUNCTION notifications_enforce();
