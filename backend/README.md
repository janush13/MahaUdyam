# MahaUdyam One — Backend

## Purpose

Backend API for **MahaUdyam One**, the Government of Maharashtra's unified
industrial approvals, compliance, and government-support platform
(Problem Statement 26130). This service implements the platform's business
logic, workflow engine, and data model as a single modular-monolith API.

> **Frontend integration is intentionally deferred.** This backend is
> currently developed and tested independently. No frontend code exists in
> this repository yet — the API is being built against a documented,
> versioned contract (`/api/docs`) so a frontend can be integrated later
> without backend rework.

## Current Implementation Status

**Step 16 — Schemes / government support services.**
`src/modules/schemes/` (FRD 29 / 34, TRD 15, Blueprint 12.7 / 13.9). **Catalogue:**
the Scheme Officer of a department *drafts* an entry (name, department,
description, benefits, plain-language eligibility criteria, optional benefit
type / sector-district-size facets / application deadline / source reference),
its eligibility **rule versions** (same closed condition grammar and evaluator as
approval discovery, imported as pure functions; immutable, highest effective
version applies, `TBD` allowed as source) and its **required documents**
(`/scheme-officer/schemes`). A separate **publish** act (FRD 34) makes it visible;
*who* publishes is FRD register item 10 (TO BE VALIDATED), so it is configuration
— `SCHEME_PUBLISHER_ROLES` (default `DEPT_ADMIN`; `SCHEME_OFFICER` /
`LEGAL_COMPLIANCE` selectable; never a System Administrator). A published scheme is
**frozen** (content, rules, requirements — service *and* database triggers); a
revision returns it to draft. Nothing is seeded. **Public browsing**
(`GET /schemes`, no account): keyword + sector / district / enterprise size /
benefit-type filters over published, active schemes only. **Recommendation**
(`…/projects/:id/scheme-recommendations`): deterministic, explainable, ranked by
the rule's department-set `priority`; every item carries the FRD 29.4 wording
and a "may be eligible" label — never a determination, no AI. **Application:**
`…/schemes/:id/apply` creates the application `APPLIED` (reference `SCH-…`, history
row, frozen catalogue + recommendation snapshot); status then moves only through
the Scheme Officer's explicit actions — `start-review`, `decision`
(approve / reject + mandatory reason), `disburse` — exactly TRD 15's flow
(`Applied → Under Review → Approved/Rejected → Disbursed`; `Disbursed` is a
marker, no amount or payment). **Evidence** reuses `DocumentsService`
(validation, malware scan fail-closed, versioning, integrity-checked download);
approving needs usable evidence for every *mandatory* requirement. **Authorisation:**
applicants and representatives through the existing enterprise/project access;
officers department-scoped from the scheme itself (404 outside, 403 without the
capability). **Notifications:** FRD 26.1 "scheme application status update" via
`NotificationEventsService`. **Audit:** `SCHEME_CREATED / _UPDATED /
_RULE_VERSION_ADDED / _DOCUMENT_REQUIREMENT_* / _PUBLISHED / _UNPUBLISHED /
_ACTIVATION_CHANGED`, `SCHEME_APPLICATION_CREATED / _STATUS_CHANGED /
_DECISION_RECORDED` (plus the document events). **Not built (no requirement
defines them):** scheme queries/clarifications (FRD 34 mentions the query
mechanism, but TRD 15's status set has no query state), withdrawal, a
scheme-type workflow (`workflow_id` stays NULL), fees, real scheme data, scheme
analytics.
**Step 14 — Compliance management.**
`src/modules/compliance/`. Post-approval obligations (FRD 27, TRD 14, Blueprint
12.6 / 13.8) — **only what a department has explicitly configured**: nothing is
seeded, inferred or defaulted (FRD 27.2), and an approval with no configured
obligation shows none, with the FRD note. **Configuration:** the *Department
Administrator of the approval type's department* — and nobody else, not even a
System Administrator (FRD 35.2) — configures a requirement
(`/admin/compliance/requirements`): plain-language description, frequency
(`ONE_TIME` / `MONTHLY` / `ANNUAL`, Blueprint 12.6), source reference, whether
evidence is required, the applicant action, an optional first-due offset in
calendar days (**`NULL` = "Due date not yet configured — TO BE VALIDATED WITH
GOVERNMENT DEPARTMENT"**, no duration is assumed) and a due window (default 0).
An edit bumps `version`; nothing is deleted (`isActive: false` stops new
occurrences). *Who* configures is not named by the requirements — this choice
follows FRD 21 and is TO BE VALIDATED. **Lifecycle:** an application in the
compliance period (TRD 3.2 `ACTIVE`) is given each active requirement's
occurrence by the hourly in-process job (`COMPLIANCE_SYNC_ENABLED`; no queue or
worker; idempotent and race-safe: created under the application row lock and a
unique index, moved by conditional updates) — the decision / certificate step
that makes an application ACTIVE does not exist yet, so the job reconciles;
`ComplianceLifecycleService.ensureOccurrences` is transaction-scoped so that
step can call it with the real activation time. Each **occurrence is its own
record** (a recurring obligation gets its next one when the previous due date is
reached, counted from the first due date; never overwritten) and **snapshots**
the requirement it was created under, so a later change never re-times or
re-words it. Status follows the date `UPCOMING → DUE → OVERDUE` (calendar dates
in the SLA calendar's UTC offset — no SLA clock, no working days) and moves only
forward; **`FULFILLED`** is the applicant's action. No route takes a status; the
database enforces the same (triggers: legal transitions, immutable snapshot,
permanent fulfilment, ACTIVE-only creation, evidence where required).
**Evidence:** `POST …/compliance/:recordId/fulfil` (multipart) goes through Step
9's one pipeline (`DocumentsService.screenAndStore` — validation, SHA-256,
malware scan fail-closed, server-generated key) and is recorded exactly as
inspection evidence is: a project-owned document reached only through its
obligation, downloadable by the applicant and by officers through the same
checked, audited download path. The requirements define no officer review of a
fulfilment, so submitting is what fulfils it (early or late; lateness is a fact
of the two dates). **Authorisation:** the applicant through the existing
enterprise access (fulfilling needs Prepare & Submit; a project-restricted
representative only their projects); officers read (`/officer/compliance`,
`/officer/applications/:id/compliance`) exactly the applications the
officer-workspace rule already lets their role see; officers have no action on
an obligation (none is defined). **Notifications:** FRD 26.1 "compliance
deadline approaching" = an obligation becoming DUE, sent through the existing
`NotificationEventsService` to the applicant side, once per occurrence. **Audit:**
`COMPLIANCE_REQUIREMENT_CREATED / _UPDATED`, `COMPLIANCE_OBLIGATION_CREATED`,
`COMPLIANCE_STATUS_CHANGED` (system), `COMPLIANCE_FULFILLED` (plus the document
events). **Not built (no requirement defines them):** renewals, penalties,
escalation, overdue notifications, officer-responsible obligations, a grace
period / lapsed state, department reporting.

**Step 13 — Notifications.**
`src/modules/notifications/` (`NotificationsCoreModule` = raising and delivering,
called by the transitions; `NotificationsModule` = the notification centre API and
the retry job). The existing `notifications` table (Blueprint 12.9) is extended,
not replaced: title, a scoping `audience` (APPLICANT / OFFICER / ACCOUNT),
references to the enterprise / project / application, a non-sensitive `payload`,
a one-way `read_at`, a per-event `dedupe_key` and the retry bookkeeping of the
optional mirrors; PostgreSQL triggers make the content immutable, read one-way
and the status transitions legal. **Events** (each in FRD 26.1 / TRD 13 *and*
backed by an implemented transition, raised after the transition commits and
never able to fail it): `APPLICATION_SUBMITTED`, `QUERY_RAISED` (applicant side),
`QUERY_RESPONDED` (the officer who raised it), `INSPECTION_SCHEDULED` /
`INSPECTION_RESCHEDULED` (applicant side, date only — never the inspector or the
site), `REPRESENTATIVE_AUTHORISATION_REQUESTED` (FRD 20.2, the invitee, also when
a widening needs fresh consent) and `SLA_WARNING` / `SLA_BREACHED` (Blueprint
23.3: the assigned officer and the department administrators). **Not** raised:
registration, draft saved, department acknowledgement, query deadline (queries
have none), approval / rejection (no decision flow yet), assignment, scrutiny
start, recommendation, inspection completion, renewal, compliance, grievance,
scheme. **Recipients are derived**, never supplied: the applicant side is the
enterprise owner plus every live representative covering the project (the same
rule the applicant routes use). **SLA integration:** a breach is notified from
`SlaLifecycleService.record` — the one place every detected breach (sweep, pause,
completion) is already recorded and audited — so nothing is recalculated and the
sweep stays idempotent; the warning is `SlaSweepService.warn`, which reuses
`measure()` and fires only at the configured `SLA_WARNING_THRESHOLD_PERCENT`
(no default), once per clock. Every dispatch is idempotent through the
(recipient, channel, dedupe key) unique index. **Delivery:** the in-app row is
written directly and *is* the delivery; optional EMAIL / SMS mirrors
(`NOTIFICATION_EXTRA_CHANNELS`, default none) go through `EmailAdapter` /
`SmsAdapter` with mock providers only (they log `[SIMULATED EMAIL|SMS]` and
withhold address and content), claimed per attempt, retried by an in-process
per-minute cron with exponential backoff up to `NOTIFICATION_MAX_ATTEMPTS` (3),
then left FAILED and audited. No queue, worker or broker. **API:**
`GET /notifications`, `GET /notifications/unread-count`, `GET /notifications/:id`,
`POST /notifications/:id/read` — any authenticated user, own notifications only,
and only those about applications the caller can *still* see (a revoked
representative or reassigned officer loses them at once; the personal offer
notice stays theirs); no route creates, edits or deletes one. Marking read is
idempotent and audited (`NOTIFICATION_READ`, identifiers only); creation is not
audited (its cause already is); a final delivery failure is
(`NOTIFICATION_DELIVERY_FAILED`). Message content is English only (languages are
TBV, TRD 13) and never carries an officer's question or observation, an
applicant's answer, the inspector, the site or a document.

**Step 12 — SLA management.**
`src/modules/sla/` (`SlaCoreModule` = clock + calendar, called by the application /
scrutiny / query transitions; `SlaModule` = views, configuration, sweep). **No
duration is shipped or defaulted** (FRD 25.3, Blueprint 23.4): a timeline is
`workflow_stages.sla_days` (working days; `NULL` = "Timeline not yet configured —
TO BE VALIDATED WITH GOVERNMENT DEPARTMENT"), set per stage by the **Department
Administrator of the stage's department** (`PUT /admin/sla/stages/:id`, with the
optional per-stage `pauseOnQuery` rule); a System Administrator, officer or
applicant cannot. **Lifecycle** (inside the transition's own transaction and
application row lock, never a status write): the clock of the workflow's entry
SCRUTINY stage *starts at submission* (`SLA_STARTED`; `due = start + sla_days`
working days, skipping weekends and the holiday calendar); a **query pauses it**
only where the stage is configured to (TRD 12: not assumed uniform) — one
`sla_pauses` row per pause, the applicant's answer resumes it and moves the
deadline forward by exactly the paused time (`SLA_PAUSED` / `SLA_RESUMED`);
finishing scrutiny (the recommendation) *completes* it (`SLA_COMPLETED`). Query
is the **only** pause reason; the expired-document pause is TBV and not
implemented, and inspections do not touch the clock (no inspection timing is
defined). Each clock **snapshots** its configuration (`sla_days`, pause rule,
original deadline), so a later change never re-times an existing application;
PostgreSQL triggers make the snapshot immutable, forbid an earlier deadline, and
make a recorded breach and a completed clock permanent. **Breach detection:**
"breached" is exactly `due_at < now` on a RUNNING clock; the hourly
`@nestjs/schedule` sweep (`SLA_SWEEP_ENABLED`) claims each clock with one
conditional UPDATE, so it is idempotent and race-safe (sweep vs sweep, pause or
completion) and audited once (`SLA_BREACHED`, `detectedBy` SWEEP / PAUSE /
COMPLETION). No queue or worker; **no notification** is sent (that module comes
later). **Reads:** applicant `GET /enterprises/:e/projects/:p/applications/:a/sla`
(FRD 25.1 fields only, through the existing enterprise access; no breach flag);
officer `GET /officer/sla` (queue) and `GET /officer/applications/:a/sla`
(countdown, breached, optional warning, every pause) over the same
department / assignment visibility as the workspace. **Calendar:**
`/admin/sla/holidays` — a Department Administrator keeps their department's,
a System Administrator the state-wide one. Working-day arithmetic uses a fixed
offset (`SLA_UTC_OFFSET_MINUTES`, default IST) and `SLA_WEEKEND_DAYS` (default
Saturday + Sunday, **TO BE VALIDATED** per department); `SLA_WARNING_THRESHOLD_PERCENT`
has no default. Configuration and holiday changes and every state change are
audited through `AuditService`.

**Step 11B — Inspection execution.**
`src/modules/inspections/` (execution + report services). The **assigned
Inspector** — and nobody else — acts on a `SCHEDULED` inspection through named
routes under `/inspections/:id`: `POST confirm`, `POST reschedule` (future date +
reason), `POST results` (one checklist result + finding), `POST evidence`
(multipart photo / document) and `POST report` (the report; **submitting it is
what completes the inspection**). `GET /inspections/:id/report` and
`GET …/evidence/:e/download` are readable by the Inspector and by the officer
roles that can already see the inspection (the report feeds the scrutiny
record); the applicant has no route. **Lifecycle:** only the existing states are
used, and the only transition executed is `SCHEDULED → COMPLETED`, inside
`submitReport`, in one transaction with the report — PostgreSQL refuses
`COMPLETED` without it. The requirements define no "confirmed", "in progress" or
"cancel" behaviour, so confirmation is *data* (`confirmed_at`, withdrawn by the
database whenever the date or inspector changes), there is no separate "start"
action (recording results is the conduct), and cancellation, the TRD's
"re-inspection required" outcome and any change to the *application's* state are
deliberately **not** implemented. **Authorisation** reuses JWT + MFA +
`RolesGuard` (INSPECTOR) and `InspectionAccessService`: the caller must be this
inspection's inspector in the application's department; every action re-checks
that, the application state (scrutiny under way) and the inspection status
**under the application's row lock**, so a reassigned inspector loses access
immediately and competing actions serialise. **Results** are the department's
checklist (`inspection_checklists`, configuration only) answered item by item;
they are **append-only** (a correction is a new row, the latest is current, the
earlier answer stays visible) and copy the item wording at the time. **Evidence**
is an ordinary Step 9 document — the *same* validate → hash → malware-scan (fail
closed) → store pipeline (`DocumentsService.screenAndStore`) — owned by the
project, never in the applicant's document list, recorded as
`inspection_evidence` (inspection → evidence → document version) with an
optional inspector-declared capture time; **no location is captured** (TRD 10.1,
TO BE VALIDATED). Only scanned, usable evidence of *this* inspection can be
cited by a result. The **report** (`inspection_report_summaries`) carries the
findings summary (compliant / non-compliant / conditional), the observations and,
for non-compliant, a corrective-action recommendation; every checklist item must
have a result first, and it is written once, never edited. All of this is also
enforced by database triggers/constraints, and every action is audited
(`INSPECTION_CONFIRMED / _RESCHEDULED / _RESULT_RECORDED / _EVIDENCE_ATTACHED /
_REPORT_SUBMITTED / _COMPLETED`) with the inspector's role, department,
enterprise/project, application and inspection, and shown in the application
history.

**Step 11A — Inspection foundation.**
`src/modules/inspections/`. An `Inspection` belongs to an **application** (TRD 23:
"FK → Application, → Officer (inspector)"): the enterprise, project and department
are reached *through* the application, never copied. It holds the inspector, the
site address, an optional schedule and assignment metadata (who created it; who
last assigned the inspector, and when). Only the assigned **Scrutiny Officer**
writes (FRD 4.3, Blueprint 13.7) while the application is under scrutiny:
`POST /officer/applications/:a/inspections` (inspector + site + optional future
date/time with an explicit UTC offset) and `PUT …/inspections/:i` (reassign — a
`reason` is required — or set/move the schedule, or change the site). The
inspector must be an *active* `INSPECTOR` of **the application's** department
(derived server-side) with no `DECLARED`/`CONFIRMED` conflict of interest on the
project (`inspector_conflicts`, TRD 10.1). Reads: `GET /officer/applications/:a/inspections`
(officer roles that can see the application), `GET /inspections` (paginated,
stable order — soonest first, unscheduled last; filters only narrow) and
`GET /inspections/:i`. An **Inspector** sees only inspections assigned to them
in a department where they hold the role, and only the minimum needed to conduct
the visit (no form data, documents, notes, enterprise details or who assigned
them); the Dept Admin sees the department, the Approving Authority only
inspections of applications awaiting a decision, all read-only. Anything outside
a caller's scope is a 404, identical to a nonexistent id. **No route takes a
status:** it is derived from the schedule (`PENDING` = no date yet,
`SCHEDULED` = has one), and `COMPLETED` / `CANCELLED` are not produced by
anything in this step. **The application's own state is not changed** — the TRD
arrows `UNDER_SCRUTINY → INSPECTION_SCHEDULED → INSPECTION_COMPLETED` need the
report step to close the loop, so they are deliberately not executable yet.
PostgreSQL enforces the data rules itself (status agrees with the schedule, at
most one open inspection per application, application/creator immutable, a
finished inspection permanent, a named workflow stage must belong to the same
application). Every write is row-locked with the application, audited
(`INSPECTION_CREATED / _SCHEDULED / _RESCHEDULED / _REASSIGNED / _SITE_UPDATED`,
also shown in the application history) and creates no new permission system.
The inspector's confirm/reschedule, checklist results, evidence and report are
Step 11B; the applicant's view, common-inspection awareness and notifications
are later.

**Step 10 — Officer workspace + application scrutiny.**
`src/modules/officer/`. Officer routes live under `/officer/**`; the **department
is always derived** from the application's approval type and compared with the
caller's own `user_roles` (`OfficerAccessService`) — a client-supplied
`departmentId` can only narrow the queue, never widen it. An application the
caller cannot see (nonexistent, a draft, another department's, or — for a
Scrutiny Officer — not assigned to them) is a 404; only a visible application
the role may not act on is a 403. Roles (least privilege, no inheritance):
**Scrutiny Officer** works only the applications assigned to them (start
scrutiny, internal observations, raise/close queries, verify/reject documents,
recommend approval or rejection); **Department Administrator** sees the whole
department and assigns/reassigns officers (`POST`/`PUT
…/assignment`, reason required to reassign, history kept, at most one active
assignment per application — a partial unique index) but does no scrutiny;
**Approving Authority** may only *view* applications awaiting a decision (the
decision itself is a later step). Inspectors and other roles have no scrutiny
capability. The queue (`GET /officer/applications`) is paginated with stable
`id` tie-breaking and filters by reference/free-text, approval type, enterprise,
project, state, applicant status, submission dates and assignment; it is plain
PostgreSQL (no search engine). Scrutiny is a set of explicit actions, each a
guarded transition (`scrutiny-state.machine.ts`, applied under a row lock):
`SUBMITTED -> UNDER_SCRUTINY -> QUERY_RAISED -> APPLICANT_RESPONDED ->
UNDER_SCRUTINY` (query loop) and `UNDER_SCRUTINY -> RECOMMENDED_FOR_APPROVAL`.
**No route takes a status and none reaches a decision state** — a recommendation
is a recommendation only. Queries are an immutable question + a write-once
applicant answer (Full Delegation or owner), one open query at a time; internal
observations, recommendations and document reviews are append-only — all
enforced by PostgreSQL triggers/constraints as well as service code. Officers
read the **stored** Step 7 discovery snapshot (never re-evaluated) and Step 9
documents (scanned/usable only; no storage keys). Every action is audited with
actor, role, department, enterprise/project, application and rule version.
Delegation/substitution, stage-level workflow assignment, SLAs, notifications
and the final decision are later steps.

**Step 9 — Document management + storage.**
`src/modules/documents/`. Documents are owned by the **project** and attached to
an application through `application_documents`; the server derives the whole
chain (authorised enterprise -> project -> application -> document) from the URL,
and a document id from any other application/project/enterprise is
indistinguishable from a nonexistent one. Authorisation is the existing
`@EnterpriseAccessRequired` guard: read/list/download need View Only, upload and
replace need Prepare & Submit (drafts only). Endpoints under
`/enterprises/:e/projects/:p/applications/:a`: `POST documents` (multipart),
`GET documents[?includeHistory]`, `GET documents/:id`, `GET documents/:id/versions`,
`GET documents/:id/download`, `POST documents/:id/replace`, and
`GET document-requirements`. There is **no delete and no status/scan write
route**: documents are historical records.
**Pipeline:** validate (filename, size, the file's REAL content type by magic
bytes — the declared type and extension must agree — and basic structure) ->
SHA-256 -> **malware scan, fail closed** -> store under a server-generated key
(`documents/<yyyy>/<uuid>`, written with overwrite disabled) -> one transaction
that locks the application, re-checks it is still a draft and writes the
document + association. Infected or unscannable files are rejected and **never
stored**. The scanner sits behind `MalwareScanner`; only a **development
stand-in (`DEV_MOCK_EICAR`, flags the public EICAR test string — NOT antivirus)**
exists, and every document records which scanner cleared it. Connect a real
scanner (e.g. ClamAV) behind that interface before relying on scanning.
**Versioning:** a replacement is a NEW immutable row (version + 1, same lineage
and requirement, naming its predecessor); nothing is overwritten. PostgreSQL
enforces it: `(lineage_id, version)` is unique, a version's file identity
(key, checksum, name, type, size, owner, scan record) can never change, and the
set of document versions current at submission is frozen on the application
(`submitted_documents`). Requirements come only from department configuration
(`document_requirements`): a mandatory one blocks submission until its CURRENT
version is scanned, usable and unexpired; with none configured nothing is
required. Limits: `DOCUMENT_MAX_SIZE_BYTES` (default 10 MiB) is a ceiling a
requirement can only lower; only PDF/JPEG/PNG are accepted (FRD 14, to be
validated with the department). Downloads are re-checked against the stored
checksum and audited. OCR, AI extraction, officer verification and document
reuse are later steps.

**Step 8 — Application lifecycle.**
`src/modules/applications/`. A project's applicant (owner, or a live
Prepare & Submit / Full representative — the existing
`@EnterpriseAccessRequired` guard, no second permission system) starts an
application for an approval that a **stored Step 7 discovery snapshot**
suggested: `POST …/projects/:projectId/applications` with only
`{ approvalTypeId, discoverySnapshotId, formData? }` (enterprise, project,
owner, workflow and status are never accepted). The application permanently
records that snapshot (foreign key) plus a copy of the matched rule
context (rule id + version, recommendation label, department), so "which rule
was used" is answerable from the row and later rule changes cannot rewrite it —
PostgreSQL triggers forbid changing an application's project, approval,
workflow, snapshot or context, and a submitted application's reference/submission
record. Discovery is never silently re-run. Two-layer status: the internal state
is engine-owned and never exposed or writable; the applicant status is derived
from it (`Draft` / `Ready to Submit` from pre-submission validation,
`Submitted`). The **only executable transition is `DRAFT → SUBMITTED`** (TRD §3.2)
through `POST …/submit` (mandatory declaration, validation re-run, atomic and
optimistic, Application Reference Number `APP-YYYY-NNNNNN` generated from a
sequence); there is no status-writing route, and every later TRD arrow
(scrutiny, query, inspection, decision…) belongs to later steps. Also:
`GET …/applications[/:id[/status]]`, enterprise-wide `GET /enterprises/:id/applications`,
`PUT …/:id/draft` (draft only; read-only once submitted, FRD §17.3) and
`POST …/:id/pre-validate` (read-only summary carrying the FRD §16.2 disclaimer).
Validation checks only what the requirements define: the draft state, an active
approval, structurally valid details and every **configured** mandatory document
requirement — no statutory field, document, fee or SLA is invented. Creating an
application requires an active workflow for the approval (`workflow_id` is
NOT NULL in the schema) and allows one live application per approval per project.
Audit: created / updated / status-changed / submitted, with actor, enterprise,
project, acting relationship and `rule_version_used`.

**Step 7 — Approval discovery + deterministic rule engine.**
`src/modules/discovery/`. A pure, dependency-free engine
(`engine/`: no I/O, no clock, no randomness, no AI — a structural test
enforces this) evaluates versioned rules against a project's stored
characteristics using a closed declarative grammar: `equals`, `in`, `not_in`,
`gt`, `lt`, `between`, combined with `all` / `any` (Blueprint §10). Rules live
in `approval_rules`: every change is a NEW version (unique per approval type),
resolved as "the highest version already effective", so history is never
edited; PostgreSQL triggers additionally forbid changing a published rule's
definition or any discovery snapshot. Each run persists a self-contained,
immutable snapshot (rule versions with definitions, inputs, full result,
engine version) and can be re-read — and re-verified as reproducible — later.
Endpoints (nested under the project so the existing
`@EnterpriseAccessRequired` guard applies): `POST …/discover-approvals`
(PREPARE_SUBMIT+), `GET …/discoveries`, `GET …/discoveries/:snapshotId`
(VIEW_ONLY+). Results are recommendations, labelled "Potentially Applicable"
unless a department flagged the rule "Officially Required" (FRD §10.3); with
no configured rule the API says so rather than guessing (FRD §10.4).
**No statutory data is seeded**: there are no approval types, departments,
rules, thresholds, fees or SLAs until departments supply them (rule
`source_reference` is mandatory; `TBD` marks an uncited one). Rule
*authoring* has no HTTP endpoint yet — it belongs to the admin module;
`ApprovalRulesService.publishVersion` is the validated, audited internal path.

**Step 6 — Project management.** `src/modules/projects/`, nested under the
enterprise (`/enterprises/:enterpriseId/projects`): create, list, view and
update projects, with a database-generated Project Reference Number
(`PRJ-<year>-<sequence>`) and the FRD §9.2 characteristics (location, sector,
size band, investment, employment, stage, land / construction / production
status, hazardous flag, conditional lease details). Authorisation reuses
Step 5's `@EnterpriseAccessRequired` — there is no second permission system:
read needs any live scope; create/update need the owner or a `FULL`
representative (Prepare & Submit is application-level in FRD §20.3, so it is
read-only for projects — one constant, `PROJECT_WRITE_LEVEL`); a
project-restricted representative sees and edits only their projects and
cannot create new ones. **The requirements define no project lifecycle**, so
there is no status field, no transition endpoint and no delete: project stage
and construction/production status are validated characteristics (closed value
sets the rule engine will match on), not states. Approval discovery is a separate, explicit
step (Step 7) and is not triggered by saving. Known limitations: no draft/submit state, no
pagination on the project list, lease-details structure (lessor + term) is a
minimal reading of an unspecified shape.

**Step 5 — Enterprise management & representative authorisation.**
`src/modules/enterprises/`: applicants create/view/update enterprises they
own (`POST/GET /enterprises`, `GET/PUT /enterprises/:enterpriseId`), with a
database-generated Enterprise Reference Number (`ENT-<year>-<sequence>`).
Owners grant, change and revoke representative access
(`/enterprises/:enterpriseId/representatives`); representatives list and
accept their own authorisations (`/representative-authorisations`) —
FRD §20's two-sided consent. Scopes `VIEW_ONLY` < `PREPARE_SUBMIT` < `FULL`,
lifecycle `PENDING` → `ACTIVE` → `REVOKED`, optional expiry (evaluated at
use time) and per-project restriction. Every enterprise-scoped operation is
authorised through one reusable primitive — `EnterpriseAccessService` /
`@EnterpriseAccessRequired(level)` — which later modules (projects,
applications) must use. Callers with no live relationship to an enterprise
get 404 (never 403), so ids cannot be probed. Known limitations: no
notification is sent to an invited representative (there is no
notification module yet — they see the invitation via
`GET /representative-authorisations`), no decline endpoint, no enterprise
deletion, and registration numbers are unverified free text (format is
TO-BE-VALIDATED, FRD §37).

**Step 4 — Authentication & authorization.** Builds on
Step 3's shared infrastructure & configuration. Database foundation
(Step 2, migrations applied and verified against the project's own Docker
PostgreSQL) plus the reusable infrastructure every future business module
will depend on: layered configuration, request correlation, the storage
abstraction, and hardened environment validation, plus the auth module (`src/modules/auth/`):
register, login, TOTP MFA (verify/enroll/confirm), refresh-token rotation,
logout, `GET /auth/me`, and the JWT/roles/permissions/department-scope
guards. **No other business modules** (applications, workflow, documents, inspections, SLA,
notifications, compliance, renewals, schemes, grievances, regulatory/RAG,
AI, analytics, audit) are implemented yet.

Implemented so far:
- NestJS application bootstrap, global `/api/v1` prefix
- **Layered configuration** (`src/config/`) — `app.config.ts`,
  `database.config.ts`, `auth.config.ts`, `storage.config.ts`,
  `ai.config.ts` composed by `configuration.ts` into one typed
  `ConfigService<AppConfig>`; nothing in the app reads `process.env`
  directly outside this layer and `main.ts`'s pre-DI bootstrap
- **Conditional environment validation** (`src/config/validation.ts`) — S3
  settings are only required when `STORAGE_DRIVER=s3`; an AI API key is
  only required when `AI_PROVIDER` is set to a real provider. Development
  needs neither by default
- Global `ValidationPipe` (whitelist, reject unknown fields, transform)
- Global exception filter enforcing the platform's standard error envelope,
  now tagged with the request's correlation ID in server-side logs
- **Request correlation** — every request gets an `X-Request-Id` (reused
  from the client if supplied and well-formed, otherwise generated),
  returned on the response and available anywhere in that request's async
  call chain via `AsyncLocalStorage` (`src/common/utils/request-context.ts`)
  — no external state store
- Configurable log verbosity (`LOG_LEVEL`) and body-size limit
  (`BODY_LIMIT`, still defaults to 10MB — see "Why 10MB?" below)
- `GET /api/v1/health` (application liveness) and `GET /api/v1/health/db`
  (live database connectivity — see "Database" below)
- Swagger/OpenAPI documentation at `/api/docs` (disabled by default in
  production, configurable via `SWAGGER_ENABLED`)
- Security defaults: Helmet, CORS scoped to `FRONTEND_URL` (credentials
  enabled, compatible with the future HTTP-only refresh-cookie design),
  graceful shutdown hooks
- **Storage abstraction** (`src/infrastructure/storage/`) — a
  `StorageService` interface (`put`/`get`/`delete`/`exists`) with a working
  `LocalStorageService` implementation, every key resolved through a
  path-traversal-safe utility before touching the filesystem. No S3
  implementation yet (kept out deliberately — see below); no upload
  endpoints, validation, OCR, or malware scanning
- **Complete Prisma schema** (`prisma/schema.prisma`, 43 models) covering
  identity/access, enterprises/projects, approval discovery, applications
  (two-layer status model), documents, workflow, inspections,
  compliance/renewal, schemes, grievances, regulatory knowledge, and
  system/audit tables
- **Migrations applied and verified** against this project's own Docker
  PostgreSQL — see "Database" below
- `PrismaService`/`PrismaModule` (connection lifecycle, graceful
  degradation if the database is unreachable — the app still starts and
  `/health` still works; the startup log only reports a connection as
  established once a real query has confirmed it, not merely after
  `$connect()` resolves)
- Seed script (`prisma/seed.ts`) for the role roster only — system
  configuration, not government/statutory data
- Dockerfile (multi-stage, Node 20) and `docker-compose.yml`
  (`backend` + `postgres` only — see "Docker" below)

## Database

Runs in **this project's own Docker container** — `pgvector/pgvector:pg16`
(PostgreSQL 16 with the pgvector extension pre-installed), isolated from
any other PostgreSQL install that may exist on your machine.

> **Host port note:** the container's Postgres port is published to **5433**
> on the host, not 5432 — see the comment in `docker-compose.yml`. If a
> different, unrelated PostgreSQL install on your machine already holds
> port 5432, this avoids the conflict without touching that install.
> Inside the Docker network the container is still reachable at
> `postgres:5432` by hostname, which is what the `backend` service itself
> uses.

This backend uses **Prisma 7**, which changed how the database connection is
configured compared to earlier Prisma versions:
- `prisma/schema.prisma`'s `datasource` block carries no `url` — connection
  info for Prisma **Migrate**/introspection comes from `prisma.config.ts`
  (which reads `DATABASE_URL` from the environment).
- The **runtime** `PrismaClient` (used by the NestJS app) requires a driver
  adapter — see `src/infrastructure/prisma/prisma.service.ts`, which builds
  a `PrismaPg` adapter (`@prisma/adapter-pg` + `pg`) from the same
  `DATABASE_URL`.

No credential is hard-coded anywhere in either path, and none is ever
returned by `/api/v1/health/db` or logged.

**Migration status:** both existing migrations
(`20260918144817_init`, `20260918144818_enable_pgvector_extension`) have
been applied to the Docker PostgreSQL container via `prisma migrate
deploy`, and independently verified live (tables, enums, foreign keys,
unique constraints, and indexes all confirmed present via direct SQL
queries — not just a successful command exit code). To reproduce:

```bash
docker compose up -d postgres
npx prisma migrate deploy   # applies the existing migration history
npx prisma generate         # regenerates the Prisma Client
npx prisma db seed          # seeds the role roster
```

`GET /api/v1/health/db` reports live connectivity at any time (runs a real
`SELECT 1`) — it never crashes the app if the database is down, and never
returns credentials or connection details.

## pgvector

The `vector` extension is enabled in the database (confirmed live via
`pg_extension`), but `regulatory_versions` has **no `embedding` column
yet**. The embedding provider is still unconfirmed — Anthropic/Claude has
no first-party embeddings endpoint, and different providers (Voyage AI,
OpenAI, Cohere, ...) produce differently-sized vectors — so no dimension is
guessed. That column is added in a future (RAG-implementation) step, once a
provider is actually selected. See the comment on `RegulatoryVersion` in
`prisma/schema.prisma`.

## Storage

`StorageService` (`src/infrastructure/storage/storage.interface.ts`) is the
only storage contract the rest of the app should ever depend on — inject it
via the `STORAGE_SERVICE` token, never `LocalStorageService` directly, so a
future S3-compatible implementation is a pure swap.

- **`STORAGE_DRIVER=local`** (default): `LocalStorageService`, rooted at
  `STORAGE_LOCAL_PATH`. Every key is resolved through
  `resolveSafeStoragePath`, which rejects absolute paths, null bytes, and
  any `..` traversal that would escape the storage root — a document key
  from an API client (once upload endpoints exist) is never trusted as a
  raw filesystem path.
- **`STORAGE_DRIVER=s3`**: not implemented yet. Selecting it fails fast at
  startup with a clear message rather than silently falling back to local
  storage. No AWS SDK dependency has been added for an unused placeholder.

No upload endpoints, document validation, OCR, or malware scanning exist —
those are a later, dedicated step.

## Technology Stack

- **Runtime:** Node.js 20
- **Framework:** NestJS (TypeScript)
- **Database:** PostgreSQL 16 (Docker, `pgvector/pgvector:pg16`) + Prisma 7
  — migrated and verified
- **Auth (implemented in `src/modules/auth/`):** JWT access token + httpOnly
  refresh cookie, TOTP MFA for officer/admin roles
- **Storage:** local disk (implemented) → S3-compatible adapter (future),
  behind the shared `StorageService` interface
- **Background jobs (planned, not yet added):** `@nestjs/schedule`,
  in-process, no queue broker
- **Search (planned):** PostgreSQL full-text search; **RAG (planned):**
  pgvector (extension enabled, embedding column deferred — see above)
- **AI (planned):** Anthropic Claude API behind a bounded module
- **Infra:** Docker Compose, Nginx (reverse proxy, added when the frontend
  exists), ClamAV (added at the document-implementation step)
- **Explicitly not used:** Redis, Kafka, RabbitMQ, BullMQ, MongoDB,
  Elasticsearch/OpenSearch, Kubernetes, microservices — see the architecture
  analysis in `../requirements/` for the reasoning.

## Prerequisites

- Node.js 20+
- npm 10+
- Docker Desktop (Engine must be *running*, not just installed)

## Installation

```bash
cd backend
npm install
```

## Environment Configuration

Copy the example file and fill in local values:

```bash
cp .env.example .env
```

| Variable | Purpose | Required? |
|---|---|---|
| `NODE_ENV` | `development` \| `test` \| `staging` \| `production` | No — defaults to `development` |
| `PORT` | HTTP port | No — defaults to `3000` |
| `API_PREFIX` | Global route prefix | No — defaults to `api/v1` |
| `FRONTEND_URL` | Allowed CORS origin | No — defaults to `http://localhost:5173` |
| `BODY_LIMIT` | JSON/urlencoded body size cap | No — defaults to `10mb` |
| `SWAGGER_ENABLED` | Force Swagger on/off | No — defaults to on outside `production` |
| `LOG_LEVEL` | `error`\|`warn`\|`log`\|`debug`\|`verbose` | No — defaults to `verbose` |
| `DATABASE_URL` | PostgreSQL connection string | **Yes** |
| `JWT_ACCESS_SECRET` / `JWT_REFRESH_SECRET` | Token signing secrets | **Yes** (validated at boot; not yet used) |
| `JWT_ACCESS_EXPIRES_IN` / `JWT_REFRESH_EXPIRES_IN` | Token lifetimes | No |
| `STORAGE_DRIVER` | `local` (default) \| `s3` | No |
| `STORAGE_LOCAL_PATH` | Local file storage root | No — defaults to `./storage` |
| `S3_ENDPOINT` / `S3_REGION` / `S3_BUCKET` / `S3_ACCESS_KEY` / `S3_SECRET_KEY` | S3-compatible storage | **Only if** `STORAGE_DRIVER=s3` |
| `AI_PROVIDER` | `none` (default) \| `anthropic` | No |
| `AI_API_KEY` / `AI_MODEL` | AI provider credentials | **Only if** `AI_PROVIDER` is not `none` |

Never commit a real `.env` file — it's git-ignored.

### Why 10MB for `BODY_LIMIT`?

Matches the architecture's document-upload NFR (~10MB/document). Not raised
without an explicit requirement — see the architecture analysis in
`../requirements/`.

## Development Commands

```bash
npm run start:dev     # watch mode
npm run start          # single run
npm run start:debug    # watch mode with debugger
```

## Build

```bash
npm run build           # compiles to dist/
npm run start:prod      # runs the compiled build
```

## Test

```bash
npm run test            # unit tests
npm run test:cov        # unit tests with coverage
npm run test:e2e        # end-to-end tests (spins up the full Nest app)
```

Unit tests never require a real database, AWS/S3 credentials, or AI
credentials — configuration/validation tests exercise the builder
functions directly, and `LocalStorageService` is tested against a real
temporary directory, not mocks.

## Lint

```bash
npm run lint
```

## Docker

Only two services — `backend` and `postgres` — deliberately, matching the
architecture (no Redis, no queue, no ClamAV yet).

```bash
docker compose config          # validate the compose file
docker compose up -d postgres  # start just the database
docker compose up -d           # start backend + postgres
docker compose ps
docker compose logs postgres
docker compose down
```

## Health Endpoints

```
GET /api/v1/health       # application liveness — never depends on the database
```
```json
{ "status": "ok", "timestamp": "2026-01-01T00:00:00.000Z" }
```

```
GET /api/v1/health/db    # live database connectivity, checked on every call
```
```json
{ "status": "up", "latencyMs": 4, "timestamp": "2026-01-01T00:00:00.000Z" }
```

## Request Correlation

Every response carries an `X-Request-Id` header — reused from the request
if the client supplied a well-formed one, otherwise generated. Server-side
logs (e.g. from the global exception filter) are tagged with the same ID,
so a client-reported issue can be traced through the logs without a
separate tracing system.

## API Documentation

Swagger UI (non-production by default, `SWAGGER_ENABLED` to override):

```
GET /api/docs
GET /api/docs-json
```

## Error Format

Every error response follows one shape, platform-wide:

```json
{
  "error": {
    "code": "ERROR_CODE",
    "message": "Human-readable message",
    "fields": { "fieldName": ["reason"] }
  }
}
```

`fields` is present only for validation errors. Production responses never
include stack traces, SQL, internal file paths, or secrets — those go to
the server log only.

## Logging Policy

Whatever logger is used in future steps, the following must never appear in
a log line: passwords, JWTs, refresh tokens, TOTP secrets, `DATABASE_URL`
(or any connection string), document contents, or application PII beyond
what's operationally necessary.
