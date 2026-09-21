-- Step 6: Project management.
--
-- FRD §9.2 (Step 6-7) requires a generated Project Reference Number and lists
-- additional site details and an expected commissioning date as optional
-- project fields. The requirements define NO project lifecycle/status, so no
-- status column is added (project_stage, construction_status and
-- production_status remain descriptive characteristics).

-- Format: PRJ-<year>-<6-digit sequence>. Same approach as
-- enterprises.reference_number: unique and race-free without retry logic.
CREATE SEQUENCE "project_reference_seq" START 1;

-- AlterTable
ALTER TABLE "projects" ADD COLUMN     "additional_site_details" TEXT,
ADD COLUMN     "expected_commissioning_date" DATE,
ADD COLUMN     "reference_number" TEXT NOT NULL DEFAULT ((('PRJ-'::text || to_char(now(), 'YYYY'::text)) || '-'::text) || lpad((nextval('project_reference_seq'::regclass))::text, 6, '0'::text));

-- CreateIndex
CREATE UNIQUE INDEX "projects_reference_number_key" ON "projects"("reference_number");
