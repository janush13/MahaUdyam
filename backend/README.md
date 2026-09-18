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

**Step 4 — Authentication & authorization (in progress).** Builds on
Step 3's shared infrastructure & configuration. Database foundation
(Step 2, migrations applied and verified against the project's own Docker
PostgreSQL) plus the reusable infrastructure every future business module
will depend on: layered configuration, request correlation, the storage
abstraction, and hardened environment validation, plus the auth module (`src/modules/auth/`):
register, login, TOTP MFA (verify/enroll/confirm), refresh-token rotation,
logout, `GET /auth/me`, and the JWT/roles/permissions/department-scope
guards. **No business modules** (enterprises, projects, approval
discovery, applications, workflow, documents, inspections, SLA,
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
