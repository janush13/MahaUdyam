-- Step 5: Enterprise management + representative authorisation.
--
-- FRD §9.2 makes sector/industry mandatory for an enterprise, lists trade
-- name / website / additional contact person as optional, and requires an
-- Enterprise Reference Number generated on save. FRD §20.3 needs a start
-- date for representative records (created_at).

-- Reference numbers come from a sequence (unique, race-free, no retry logic
-- in the application). Format: ENT-<year>-<6-digit sequence>.
CREATE SEQUENCE "enterprise_reference_seq" START 1;

-- AlterTable
ALTER TABLE "enterprise_representatives" ADD COLUMN     "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- AlterTable
-- `sector` is mandatory, so a NOT NULL column with no default would fail if
-- any enterprise rows existed. A temporary default backfills them, then is
-- dropped so new rows must always supply a real value.
ALTER TABLE "enterprises" ADD COLUMN     "contact_person_mobile" TEXT,
ADD COLUMN     "contact_person_name" TEXT,
ADD COLUMN     "reference_number" TEXT NOT NULL DEFAULT ((('ENT-'::text || to_char(now(), 'YYYY'::text)) || '-'::text) || lpad((nextval('enterprise_reference_seq'::regclass))::text, 6, '0'::text)),
ADD COLUMN     "sector" TEXT NOT NULL DEFAULT 'UNSPECIFIED',
ADD COLUMN     "trade_name" TEXT,
ADD COLUMN     "website" TEXT;

ALTER TABLE "enterprises" ALTER COLUMN "sector" DROP DEFAULT;

-- CreateIndex
CREATE UNIQUE INDEX "enterprises_reference_number_key" ON "enterprises"("reference_number");
