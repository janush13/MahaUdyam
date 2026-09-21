-- MahaUdyam One — initial database foundation migration.
--
-- PROVENANCE: generated via `prisma migrate diff --from-empty --to-schema
-- prisma/schema.prisma --script`, NOT via `prisma migrate dev`. No live
-- PostgreSQL connection was available with valid credentials in the
-- environment this was authored in (see the Step 2 execution report,
-- "PostgreSQL Version / Availability" and "Migration Details" sections for
-- the full explanation). This file is Prisma's own schema-engine output —
-- not hand-written — but it has NOT been applied to or tested against a
-- live database yet. Do not treat it as verified until `prisma migrate
-- dev` (or `prisma migrate deploy` against a real target) has actually
-- been run and this directory has a corresponding row in the
-- `_prisma_migrations` table.
--
-- Prisma version: 7.10.0. Target database: PostgreSQL 16
-- (pgvector/pgvector:pg16 image — see docker-compose.yml).

-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "representative_scope" AS ENUM ('VIEW_ONLY', 'PREPARE_SUBMIT', 'FULL');

-- CreateEnum
CREATE TYPE "representative_status" AS ENUM ('PENDING', 'ACTIVE', 'REVOKED');

-- CreateEnum
CREATE TYPE "internal_application_state" AS ENUM ('DRAFT', 'SUBMITTED', 'UNDER_SCRUTINY', 'QUERY_RAISED', 'APPLICANT_RESPONDED', 'INSPECTION_SCHEDULED', 'INSPECTION_COMPLETED', 'RECOMMENDED_FOR_APPROVAL', 'APPROVED', 'REJECTED', 'CERTIFICATE_ISSUED', 'ACTIVE', 'RENEWAL_DUE', 'RENEWAL_SUBMITTED', 'EXPIRED', 'WITHDRAWN_BY_APPLICANT', 'CANCELLED', 'DUPLICATE_FLAGGED');

-- CreateEnum
CREATE TYPE "applicant_status" AS ENUM ('DRAFT', 'READY_TO_SUBMIT', 'SUBMITTED', 'UNDER_SCRUTINY', 'QUERY_RAISED', 'AWAITING_APPLICANT', 'INSPECTION_PENDING', 'INSPECTION_SCHEDULED', 'AWAITING_DECISION', 'APPROVED', 'REJECTED', 'WITHDRAWN', 'CLOSED', 'RENEWAL_DUE');

-- CreateEnum
CREATE TYPE "risk_band" AS ENUM ('LOW', 'MEDIUM', 'HIGH');

-- CreateEnum
CREATE TYPE "application_stage_status" AS ENUM ('PENDING', 'ACTIVE', 'COMPLETED', 'SKIPPED');

-- CreateEnum
CREATE TYPE "application_task_type" AS ENUM ('QUERY', 'CORRECTION', 'REVIEW', 'ESCALATION');

-- CreateEnum
CREATE TYPE "application_task_status" AS ENUM ('OPEN', 'RESOLVED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "document_owner_type" AS ENUM ('ENTERPRISE', 'PROJECT');

-- CreateEnum
CREATE TYPE "document_status" AS ENUM ('UPLOADED', 'SCAN_PENDING', 'VALIDATION_PENDING', 'VERIFIED', 'REJECTED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "workflow_stage_type" AS ENUM ('SCRUTINY', 'INSPECTION', 'DECISION');

-- CreateEnum
CREATE TYPE "inspection_status" AS ENUM ('PENDING', 'SCHEDULED', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "inspection_finding" AS ENUM ('COMPLIANT', 'NON_COMPLIANT', 'CONDITIONAL');

-- CreateEnum
CREATE TYPE "inspector_conflict_status" AS ENUM ('DECLARED', 'CLEARED', 'CONFIRMED');

-- CreateEnum
CREATE TYPE "compliance_frequency" AS ENUM ('ONE_TIME', 'MONTHLY', 'ANNUAL');

-- CreateEnum
CREATE TYPE "compliance_record_status" AS ENUM ('UPCOMING', 'DUE', 'OVERDUE', 'FULFILLED');

-- CreateEnum
CREATE TYPE "scheme_publish_status" AS ENUM ('DRAFT', 'PUBLISHED');

-- CreateEnum
CREATE TYPE "grievance_status" AS ENUM ('OPEN', 'ASSIGNED', 'RESOLVED', 'ESCALATED', 'CLOSED', 'REOPENED');

-- CreateEnum
CREATE TYPE "grievance_update_type" AS ENUM ('COMMENT', 'STATUS_CHANGE', 'ESCALATION');

-- CreateEnum
CREATE TYPE "regulatory_publish_status" AS ENUM ('DRAFT', 'LEGAL_REVIEW', 'APPROVED', 'PUBLISHED');

-- CreateEnum
CREATE TYPE "notification_channel" AS ENUM ('IN_APP', 'EMAIL', 'SMS');

-- CreateEnum
CREATE TYPE "notification_status" AS ENUM ('PENDING', 'SENT', 'FAILED', 'READ');

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "mobile" TEXT NOT NULL,
    "password_hash" TEXT,
    "is_verified" BOOLEAN NOT NULL DEFAULT false,
    "mfa_enabled" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "roles" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "code" TEXT NOT NULL,
    "description" TEXT,

    CONSTRAINT "roles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "permissions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "code" TEXT NOT NULL,
    "description" TEXT,

    CONSTRAINT "permissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "role_permissions" (
    "role_id" UUID NOT NULL,
    "permission_id" UUID NOT NULL,

    CONSTRAINT "role_permissions_pkey" PRIMARY KEY ("role_id","permission_id")
);

-- CreateTable
CREATE TABLE "user_roles" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "role_id" UUID NOT NULL,
    "department_id" UUID,

    CONSTRAINT "user_roles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mfa_credentials" (
    "user_id" UUID NOT NULL,
    "totp_secret" TEXT NOT NULL,
    "enabled_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "mfa_credentials_pkey" PRIMARY KEY ("user_id")
);

-- CreateTable
CREATE TABLE "departments" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "departments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "enterprises" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "name" TEXT NOT NULL,
    "business_type" TEXT NOT NULL,
    "registration_number" TEXT NOT NULL,
    "registration_number_type" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "owner_user_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "enterprises_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "enterprise_representatives" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "enterprise_id" UUID NOT NULL,
    "representative_user_id" UUID NOT NULL,
    "scope" "representative_scope" NOT NULL,
    "scoped_project_ids" UUID[] DEFAULT ARRAY[]::UUID[],
    "status" "representative_status" NOT NULL DEFAULT 'PENDING',
    "authorised_at" TIMESTAMP(3),
    "expires_at" TIMESTAMP(3),
    "revoked_at" TIMESTAMP(3),

    CONSTRAINT "enterprise_representatives_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "projects" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "enterprise_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "district" TEXT NOT NULL,
    "taluka" TEXT NOT NULL,
    "industrial_area" TEXT,
    "sector_code" TEXT NOT NULL,
    "enterprise_size_band" TEXT NOT NULL,
    "investment_amount" DECIMAL(16,2) NOT NULL,
    "employment_count" INTEGER NOT NULL,
    "land_status" TEXT NOT NULL,
    "land_lease_details" JSONB,
    "construction_status" TEXT NOT NULL,
    "production_status" TEXT NOT NULL,
    "environmental_category" TEXT,
    "hazardous_flag" BOOLEAN NOT NULL,
    "hazardous_category" TEXT,
    "project_stage" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "projects_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "approval_types" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "name" TEXT NOT NULL,
    "legal_name" TEXT,
    "department_id" UUID NOT NULL,
    "description" TEXT,
    "legal_reference" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "approval_types_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "approval_rules" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "approval_type_id" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "effective_from" TIMESTAMP(3) NOT NULL,
    "effective_to" TIMESTAMP(3),
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "is_officially_required" BOOLEAN NOT NULL DEFAULT false,
    "conditions" JSONB NOT NULL,
    "excludes_if" JSONB,
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "approval_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "approval_dependencies" (
    "approval_type_id" UUID NOT NULL,
    "depends_on_approval_type_id" UUID NOT NULL,

    CONSTRAINT "approval_dependencies_pkey" PRIMARY KEY ("approval_type_id","depends_on_approval_type_id")
);

-- CreateTable
CREATE TABLE "discovery_snapshots" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "project_id" UUID NOT NULL,
    "evaluated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "rule_versions_used" JSONB NOT NULL,
    "matched_approval_type_ids" UUID[] DEFAULT ARRAY[]::UUID[],

    CONSTRAINT "discovery_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "approval_applications" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "project_id" UUID NOT NULL,
    "approval_type_id" UUID NOT NULL,
    "workflow_id" UUID NOT NULL,
    "internal_state" "internal_application_state" NOT NULL DEFAULT 'DRAFT',
    "applicant_status" "applicant_status" NOT NULL DEFAULT 'DRAFT',
    "previous_application_id" UUID,
    "reference_number" TEXT,
    "submitted_at" TIMESTAMP(3),
    "decided_at" TIMESTAMP(3),
    "decision_reason" TEXT,
    "risk_band" "risk_band",
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "approval_applications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "application_stages" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "application_id" UUID NOT NULL,
    "workflow_stage_id" UUID NOT NULL,
    "status" "application_stage_status" NOT NULL DEFAULT 'PENDING',
    "started_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    "sla_due_at" TIMESTAMP(3),
    "sla_paused_at" TIMESTAMP(3),
    "assigned_officer_id" UUID,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "application_stages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "application_tasks" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "application_stage_id" UUID NOT NULL,
    "type" "application_task_type" NOT NULL,
    "round_number" INTEGER NOT NULL DEFAULT 1,
    "status" "application_task_status" NOT NULL DEFAULT 'OPEN',
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolved_at" TIMESTAMP(3),

    CONSTRAINT "application_tasks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "documents" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "owner_type" "document_owner_type" NOT NULL,
    "owner_id" UUID NOT NULL,
    "document_requirement_id" UUID,
    "file_path" TEXT NOT NULL,
    "checksum" TEXT NOT NULL,
    "original_filename" TEXT NOT NULL,
    "mime_type" TEXT NOT NULL,
    "size_bytes" INTEGER NOT NULL,
    "status" "document_status" NOT NULL DEFAULT 'UPLOADED',
    "expiry_date" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 1,
    "replaced_document_id" UUID,
    "uploaded_by" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "application_documents" (
    "application_id" UUID NOT NULL,
    "document_id" UUID NOT NULL,

    CONSTRAINT "application_documents_pkey" PRIMARY KEY ("application_id","document_id")
);

-- CreateTable
CREATE TABLE "document_requirements" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "approval_type_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "is_mandatory" BOOLEAN NOT NULL,
    "is_reusable" BOOLEAN NOT NULL DEFAULT false,
    "max_size_bytes" INTEGER,
    "allowed_mime_types" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "description" TEXT,

    CONSTRAINT "document_requirements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "document_verifications" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "document_id" UUID NOT NULL,
    "verified_by_user_id" UUID NOT NULL,
    "verified_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "notes" TEXT,
    "valid_until" TIMESTAMP(3),

    CONSTRAINT "document_verifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workflows" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "approval_type_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "workflows_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workflow_stages" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "workflow_id" UUID NOT NULL,
    "sequence_order" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "department_id" UUID NOT NULL,
    "stage_type" "workflow_stage_type" NOT NULL,
    "sla_days" INTEGER,
    "sla_pause_on_query" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "workflow_stages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workflow_stage_dependencies" (
    "workflow_stage_id" UUID NOT NULL,
    "depends_on_workflow_stage_id" UUID NOT NULL,

    CONSTRAINT "workflow_stage_dependencies_pkey" PRIMARY KEY ("workflow_stage_id","depends_on_workflow_stage_id")
);

-- CreateTable
CREATE TABLE "officer_delegations" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "from_officer_id" UUID NOT NULL,
    "to_officer_id" UUID NOT NULL,
    "department_id" UUID NOT NULL,
    "start_date" TIMESTAMP(3) NOT NULL,
    "end_date" TIMESTAMP(3) NOT NULL,
    "reason" TEXT NOT NULL,
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "officer_delegations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inspections" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "application_stage_id" UUID NOT NULL,
    "inspector_id" UUID NOT NULL,
    "scheduled_at" TIMESTAMP(3),
    "status" "inspection_status" NOT NULL DEFAULT 'PENDING',
    "site_address" TEXT NOT NULL,
    "geo_consent_given" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "inspections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inspection_checklists" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "approval_type_id" UUID NOT NULL,
    "item_text" TEXT NOT NULL,
    "sequence_order" INTEGER NOT NULL,

    CONSTRAINT "inspection_checklists_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inspection_reports" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "inspection_id" UUID NOT NULL,
    "checklist_item_id" UUID NOT NULL,
    "response" TEXT NOT NULL,
    "evidence_document_id" UUID,
    "finding" "inspection_finding" NOT NULL,
    "notes" TEXT,

    CONSTRAINT "inspection_reports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inspector_conflicts" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "inspector_id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "declared_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reviewed_by" UUID,
    "status" "inspector_conflict_status" NOT NULL DEFAULT 'DECLARED',

    CONSTRAINT "inspector_conflicts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "compliance_requirements" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "approval_type_id" UUID NOT NULL,
    "description" TEXT NOT NULL,
    "frequency" "compliance_frequency" NOT NULL,

    CONSTRAINT "compliance_requirements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "compliance_records" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "application_id" UUID NOT NULL,
    "compliance_requirement_id" UUID NOT NULL,
    "due_date" TIMESTAMP(3) NOT NULL,
    "status" "compliance_record_status" NOT NULL DEFAULT 'UPCOMING',
    "fulfilled_document_id" UUID,

    CONSTRAINT "compliance_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "renewals" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "original_application_id" UUID NOT NULL,
    "new_application_id" UUID,
    "renewal_due_date" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL,
    "reminder_schedule" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "renewals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "schemes" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "name" TEXT NOT NULL,
    "department_id" UUID NOT NULL,
    "description" TEXT NOT NULL,
    "benefits" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "publish_status" "scheme_publish_status" NOT NULL DEFAULT 'DRAFT',

    CONSTRAINT "schemes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "scheme_rules" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "scheme_id" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "effective_from" TIMESTAMP(3) NOT NULL,
    "effective_to" TIMESTAMP(3),
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "conditions" JSONB NOT NULL,

    CONSTRAINT "scheme_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "scheme_applications" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "scheme_id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "workflow_id" UUID NOT NULL,
    "status" TEXT NOT NULL,
    "submitted_at" TIMESTAMP(3),
    "decided_at" TIMESTAMP(3),
    "reference_number" TEXT,

    CONSTRAINT "scheme_applications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "grievances" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "raised_by_user_id" UUID NOT NULL,
    "application_id" UUID,
    "category" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "status" "grievance_status" NOT NULL DEFAULT 'OPEN',
    "assigned_department_id" UUID NOT NULL,
    "assigned_officer_id" UUID,
    "sla_due_at" TIMESTAMP(3),
    "reopen_deadline" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolved_at" TIMESTAMP(3),

    CONSTRAINT "grievances_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "grievance_updates" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "grievance_id" UUID NOT NULL,
    "actor_user_id" UUID NOT NULL,
    "update_type" "grievance_update_type" NOT NULL,
    "message" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "grievance_updates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "regulatory_documents" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "title" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "document_type" TEXT NOT NULL,
    "applicable_approval_type_id" UUID,
    "uploaded_by" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "regulatory_documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "regulatory_versions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "regulatory_document_id" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "effective_from" TIMESTAMP(3) NOT NULL,
    "effective_to" TIMESTAMP(3),
    "publish_status" "regulatory_publish_status" NOT NULL DEFAULT 'DRAFT',
    "summary" TEXT,
    "requirements" TEXT,
    "related_documents" JSONB,
    "content" TEXT NOT NULL,

    CONSTRAINT "regulatory_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notifications" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "event_type" TEXT NOT NULL,
    "channel" "notification_channel" NOT NULL,
    "message" TEXT NOT NULL,
    "status" "notification_status" NOT NULL DEFAULT 'PENDING',
    "attempt_count" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sent_at" TIMESTAMP(3),

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notification_templates" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "event_type" TEXT NOT NULL,
    "language" TEXT NOT NULL,
    "channel" "notification_channel" NOT NULL,
    "subject_template" TEXT,
    "body_template" TEXT NOT NULL,

    CONSTRAINT "notification_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID,
    "role_at_time" TEXT,
    "action" TEXT NOT NULL,
    "entity_type" TEXT NOT NULL,
    "entity_id" UUID NOT NULL,
    "before_state" JSONB,
    "after_state" JSONB,
    "ip_address" TEXT NOT NULL,
    "rule_version_used" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "retention_policy" (
    "entity_type" TEXT NOT NULL,
    "retention_days" INTEGER,

    CONSTRAINT "retention_policy_pkey" PRIMARY KEY ("entity_type")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "users_mobile_key" ON "users"("mobile");

-- CreateIndex
CREATE UNIQUE INDEX "roles_code_key" ON "roles"("code");

-- CreateIndex
CREATE UNIQUE INDEX "permissions_code_key" ON "permissions"("code");

-- CreateIndex
CREATE INDEX "user_roles_user_id_idx" ON "user_roles"("user_id");

-- CreateIndex
CREATE INDEX "user_roles_role_id_idx" ON "user_roles"("role_id");

-- CreateIndex
CREATE INDEX "user_roles_department_id_idx" ON "user_roles"("department_id");

-- CreateIndex
CREATE UNIQUE INDEX "departments_code_key" ON "departments"("code");

-- CreateIndex
CREATE INDEX "enterprises_owner_user_id_idx" ON "enterprises"("owner_user_id");

-- CreateIndex
CREATE INDEX "enterprise_representatives_enterprise_id_idx" ON "enterprise_representatives"("enterprise_id");

-- CreateIndex
CREATE INDEX "enterprise_representatives_representative_user_id_idx" ON "enterprise_representatives"("representative_user_id");

-- CreateIndex
CREATE INDEX "projects_enterprise_id_idx" ON "projects"("enterprise_id");

-- CreateIndex
CREATE INDEX "approval_types_department_id_idx" ON "approval_types"("department_id");

-- CreateIndex
CREATE INDEX "approval_rules_approval_type_id_idx" ON "approval_rules"("approval_type_id");

-- CreateIndex
CREATE INDEX "approval_rules_effective_from_idx" ON "approval_rules"("effective_from");

-- CreateIndex
CREATE INDEX "approval_rules_effective_to_idx" ON "approval_rules"("effective_to");

-- CreateIndex
CREATE INDEX "discovery_snapshots_project_id_idx" ON "discovery_snapshots"("project_id");

-- CreateIndex
CREATE UNIQUE INDEX "approval_applications_reference_number_key" ON "approval_applications"("reference_number");

-- CreateIndex
CREATE INDEX "approval_applications_project_id_idx" ON "approval_applications"("project_id");

-- CreateIndex
CREATE INDEX "approval_applications_approval_type_id_idx" ON "approval_applications"("approval_type_id");

-- CreateIndex
CREATE INDEX "approval_applications_internal_state_idx" ON "approval_applications"("internal_state");

-- CreateIndex
CREATE INDEX "approval_applications_applicant_status_idx" ON "approval_applications"("applicant_status");

-- CreateIndex
CREATE INDEX "application_stages_application_id_idx" ON "application_stages"("application_id");

-- CreateIndex
CREATE INDEX "application_stages_assigned_officer_id_idx" ON "application_stages"("assigned_officer_id");

-- CreateIndex
CREATE INDEX "application_tasks_application_stage_id_idx" ON "application_tasks"("application_stage_id");

-- CreateIndex
CREATE INDEX "documents_owner_id_idx" ON "documents"("owner_id");

-- CreateIndex
CREATE INDEX "documents_checksum_idx" ON "documents"("checksum");

-- CreateIndex
CREATE INDEX "documents_expiry_date_idx" ON "documents"("expiry_date");

-- CreateIndex
CREATE INDEX "application_documents_application_id_idx" ON "application_documents"("application_id");

-- CreateIndex
CREATE INDEX "application_documents_document_id_idx" ON "application_documents"("document_id");

-- CreateIndex
CREATE INDEX "document_requirements_approval_type_id_idx" ON "document_requirements"("approval_type_id");

-- CreateIndex
CREATE INDEX "document_verifications_document_id_idx" ON "document_verifications"("document_id");

-- CreateIndex
CREATE INDEX "workflows_approval_type_id_idx" ON "workflows"("approval_type_id");

-- CreateIndex
CREATE INDEX "workflow_stages_workflow_id_idx" ON "workflow_stages"("workflow_id");

-- CreateIndex
CREATE INDEX "inspections_inspector_id_idx" ON "inspections"("inspector_id");

-- CreateIndex
CREATE INDEX "inspections_scheduled_at_idx" ON "inspections"("scheduled_at");

-- CreateIndex
CREATE INDEX "inspection_checklists_approval_type_id_idx" ON "inspection_checklists"("approval_type_id");

-- CreateIndex
CREATE INDEX "inspection_reports_inspection_id_idx" ON "inspection_reports"("inspection_id");

-- CreateIndex
CREATE INDEX "compliance_requirements_approval_type_id_idx" ON "compliance_requirements"("approval_type_id");

-- CreateIndex
CREATE INDEX "compliance_records_application_id_idx" ON "compliance_records"("application_id");

-- CreateIndex
CREATE INDEX "schemes_department_id_idx" ON "schemes"("department_id");

-- CreateIndex
CREATE INDEX "scheme_rules_scheme_id_idx" ON "scheme_rules"("scheme_id");

-- CreateIndex
CREATE UNIQUE INDEX "scheme_applications_reference_number_key" ON "scheme_applications"("reference_number");

-- CreateIndex
CREATE INDEX "grievances_assigned_department_id_idx" ON "grievances"("assigned_department_id");

-- CreateIndex
CREATE INDEX "grievances_assigned_officer_id_idx" ON "grievances"("assigned_officer_id");

-- CreateIndex
CREATE INDEX "grievance_updates_grievance_id_idx" ON "grievance_updates"("grievance_id");

-- CreateIndex
CREATE INDEX "regulatory_versions_regulatory_document_id_idx" ON "regulatory_versions"("regulatory_document_id");

-- CreateIndex
CREATE INDEX "notifications_user_id_idx" ON "notifications"("user_id");

-- CreateIndex
CREATE INDEX "notifications_status_idx" ON "notifications"("status");

-- CreateIndex
CREATE UNIQUE INDEX "notification_templates_event_type_language_channel_key" ON "notification_templates"("event_type", "language", "channel");

-- CreateIndex
CREATE INDEX "audit_logs_entity_type_entity_id_idx" ON "audit_logs"("entity_type", "entity_id");

-- CreateIndex
CREATE INDEX "audit_logs_created_at_idx" ON "audit_logs"("created_at");

-- AddForeignKey
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "roles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_permission_id_fkey" FOREIGN KEY ("permission_id") REFERENCES "permissions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "roles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_department_id_fkey" FOREIGN KEY ("department_id") REFERENCES "departments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mfa_credentials" ADD CONSTRAINT "mfa_credentials_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "enterprises" ADD CONSTRAINT "enterprises_owner_user_id_fkey" FOREIGN KEY ("owner_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "enterprise_representatives" ADD CONSTRAINT "enterprise_representatives_enterprise_id_fkey" FOREIGN KEY ("enterprise_id") REFERENCES "enterprises"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "enterprise_representatives" ADD CONSTRAINT "enterprise_representatives_representative_user_id_fkey" FOREIGN KEY ("representative_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "projects" ADD CONSTRAINT "projects_enterprise_id_fkey" FOREIGN KEY ("enterprise_id") REFERENCES "enterprises"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approval_types" ADD CONSTRAINT "approval_types_department_id_fkey" FOREIGN KEY ("department_id") REFERENCES "departments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approval_rules" ADD CONSTRAINT "approval_rules_approval_type_id_fkey" FOREIGN KEY ("approval_type_id") REFERENCES "approval_types"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approval_rules" ADD CONSTRAINT "approval_rules_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approval_dependencies" ADD CONSTRAINT "approval_dependencies_approval_type_id_fkey" FOREIGN KEY ("approval_type_id") REFERENCES "approval_types"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approval_dependencies" ADD CONSTRAINT "approval_dependencies_depends_on_approval_type_id_fkey" FOREIGN KEY ("depends_on_approval_type_id") REFERENCES "approval_types"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "discovery_snapshots" ADD CONSTRAINT "discovery_snapshots_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approval_applications" ADD CONSTRAINT "approval_applications_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approval_applications" ADD CONSTRAINT "approval_applications_approval_type_id_fkey" FOREIGN KEY ("approval_type_id") REFERENCES "approval_types"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approval_applications" ADD CONSTRAINT "approval_applications_workflow_id_fkey" FOREIGN KEY ("workflow_id") REFERENCES "workflows"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approval_applications" ADD CONSTRAINT "approval_applications_previous_application_id_fkey" FOREIGN KEY ("previous_application_id") REFERENCES "approval_applications"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "application_stages" ADD CONSTRAINT "application_stages_application_id_fkey" FOREIGN KEY ("application_id") REFERENCES "approval_applications"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "application_stages" ADD CONSTRAINT "application_stages_workflow_stage_id_fkey" FOREIGN KEY ("workflow_stage_id") REFERENCES "workflow_stages"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "application_stages" ADD CONSTRAINT "application_stages_assigned_officer_id_fkey" FOREIGN KEY ("assigned_officer_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "application_tasks" ADD CONSTRAINT "application_tasks_application_stage_id_fkey" FOREIGN KEY ("application_stage_id") REFERENCES "application_stages"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "application_tasks" ADD CONSTRAINT "application_tasks_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "documents" ADD CONSTRAINT "documents_document_requirement_id_fkey" FOREIGN KEY ("document_requirement_id") REFERENCES "document_requirements"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "documents" ADD CONSTRAINT "documents_replaced_document_id_fkey" FOREIGN KEY ("replaced_document_id") REFERENCES "documents"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "documents" ADD CONSTRAINT "documents_uploaded_by_fkey" FOREIGN KEY ("uploaded_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "application_documents" ADD CONSTRAINT "application_documents_application_id_fkey" FOREIGN KEY ("application_id") REFERENCES "approval_applications"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "application_documents" ADD CONSTRAINT "application_documents_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_requirements" ADD CONSTRAINT "document_requirements_approval_type_id_fkey" FOREIGN KEY ("approval_type_id") REFERENCES "approval_types"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_verifications" ADD CONSTRAINT "document_verifications_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "documents"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_verifications" ADD CONSTRAINT "document_verifications_verified_by_user_id_fkey" FOREIGN KEY ("verified_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workflows" ADD CONSTRAINT "workflows_approval_type_id_fkey" FOREIGN KEY ("approval_type_id") REFERENCES "approval_types"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workflow_stages" ADD CONSTRAINT "workflow_stages_workflow_id_fkey" FOREIGN KEY ("workflow_id") REFERENCES "workflows"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workflow_stages" ADD CONSTRAINT "workflow_stages_department_id_fkey" FOREIGN KEY ("department_id") REFERENCES "departments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workflow_stage_dependencies" ADD CONSTRAINT "workflow_stage_dependencies_workflow_stage_id_fkey" FOREIGN KEY ("workflow_stage_id") REFERENCES "workflow_stages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workflow_stage_dependencies" ADD CONSTRAINT "workflow_stage_dependencies_depends_on_workflow_stage_id_fkey" FOREIGN KEY ("depends_on_workflow_stage_id") REFERENCES "workflow_stages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "officer_delegations" ADD CONSTRAINT "officer_delegations_from_officer_id_fkey" FOREIGN KEY ("from_officer_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "officer_delegations" ADD CONSTRAINT "officer_delegations_to_officer_id_fkey" FOREIGN KEY ("to_officer_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "officer_delegations" ADD CONSTRAINT "officer_delegations_department_id_fkey" FOREIGN KEY ("department_id") REFERENCES "departments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "officer_delegations" ADD CONSTRAINT "officer_delegations_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inspections" ADD CONSTRAINT "inspections_application_stage_id_fkey" FOREIGN KEY ("application_stage_id") REFERENCES "application_stages"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inspections" ADD CONSTRAINT "inspections_inspector_id_fkey" FOREIGN KEY ("inspector_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inspection_checklists" ADD CONSTRAINT "inspection_checklists_approval_type_id_fkey" FOREIGN KEY ("approval_type_id") REFERENCES "approval_types"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inspection_reports" ADD CONSTRAINT "inspection_reports_inspection_id_fkey" FOREIGN KEY ("inspection_id") REFERENCES "inspections"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inspection_reports" ADD CONSTRAINT "inspection_reports_checklist_item_id_fkey" FOREIGN KEY ("checklist_item_id") REFERENCES "inspection_checklists"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inspection_reports" ADD CONSTRAINT "inspection_reports_evidence_document_id_fkey" FOREIGN KEY ("evidence_document_id") REFERENCES "documents"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inspector_conflicts" ADD CONSTRAINT "inspector_conflicts_inspector_id_fkey" FOREIGN KEY ("inspector_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inspector_conflicts" ADD CONSTRAINT "inspector_conflicts_reviewed_by_fkey" FOREIGN KEY ("reviewed_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inspector_conflicts" ADD CONSTRAINT "inspector_conflicts_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "compliance_requirements" ADD CONSTRAINT "compliance_requirements_approval_type_id_fkey" FOREIGN KEY ("approval_type_id") REFERENCES "approval_types"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "compliance_records" ADD CONSTRAINT "compliance_records_application_id_fkey" FOREIGN KEY ("application_id") REFERENCES "approval_applications"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "compliance_records" ADD CONSTRAINT "compliance_records_compliance_requirement_id_fkey" FOREIGN KEY ("compliance_requirement_id") REFERENCES "compliance_requirements"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "compliance_records" ADD CONSTRAINT "compliance_records_fulfilled_document_id_fkey" FOREIGN KEY ("fulfilled_document_id") REFERENCES "documents"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "renewals" ADD CONSTRAINT "renewals_original_application_id_fkey" FOREIGN KEY ("original_application_id") REFERENCES "approval_applications"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "renewals" ADD CONSTRAINT "renewals_new_application_id_fkey" FOREIGN KEY ("new_application_id") REFERENCES "approval_applications"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "schemes" ADD CONSTRAINT "schemes_department_id_fkey" FOREIGN KEY ("department_id") REFERENCES "departments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scheme_rules" ADD CONSTRAINT "scheme_rules_scheme_id_fkey" FOREIGN KEY ("scheme_id") REFERENCES "schemes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scheme_applications" ADD CONSTRAINT "scheme_applications_scheme_id_fkey" FOREIGN KEY ("scheme_id") REFERENCES "schemes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scheme_applications" ADD CONSTRAINT "scheme_applications_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scheme_applications" ADD CONSTRAINT "scheme_applications_workflow_id_fkey" FOREIGN KEY ("workflow_id") REFERENCES "workflows"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "grievances" ADD CONSTRAINT "grievances_raised_by_user_id_fkey" FOREIGN KEY ("raised_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "grievances" ADD CONSTRAINT "grievances_application_id_fkey" FOREIGN KEY ("application_id") REFERENCES "approval_applications"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "grievances" ADD CONSTRAINT "grievances_assigned_department_id_fkey" FOREIGN KEY ("assigned_department_id") REFERENCES "departments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "grievances" ADD CONSTRAINT "grievances_assigned_officer_id_fkey" FOREIGN KEY ("assigned_officer_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "grievance_updates" ADD CONSTRAINT "grievance_updates_grievance_id_fkey" FOREIGN KEY ("grievance_id") REFERENCES "grievances"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "grievance_updates" ADD CONSTRAINT "grievance_updates_actor_user_id_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "regulatory_documents" ADD CONSTRAINT "regulatory_documents_applicable_approval_type_id_fkey" FOREIGN KEY ("applicable_approval_type_id") REFERENCES "approval_types"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "regulatory_documents" ADD CONSTRAINT "regulatory_documents_uploaded_by_fkey" FOREIGN KEY ("uploaded_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "regulatory_versions" ADD CONSTRAINT "regulatory_versions_regulatory_document_id_fkey" FOREIGN KEY ("regulatory_document_id") REFERENCES "regulatory_documents"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

