# CNC-V1-00 — Deployment, Provisioning & Operations

**Status:** `VERIFIED_DONE` (2026-08-12)

This runbook is the supported reference deployment for one on-premise AHK CNC
Manufacturing customer. It intentionally does not introduce a SaaS control
plane or make Entitlements V2 authoritative.

## Reference topology

```
Browser ── TLS reverse proxy ── web (nginx) ── backend API ── PostgreSQL 16
                                      │
                                      └────────────── MinIO document storage
Factory edge connector ────────────── HTTPS/backend API ── CNC controller
```

Keep PostgreSQL and MinIO off public networks. The connector is an optional
edge process; its absence does not make the MES backend readiness endpoint
fail. Its machine-specific status is diagnosed separately.

Minimum reference host: Docker Engine/Compose v2, 4 vCPU, 8 GB free RAM and
40 GB persistent disk (size PostgreSQL/MinIO retention for actual production).
Expose only the reverse-proxy HTTPS port to browsers. Permit connector-to-API
traffic and controller-specific traffic only between the edge host and selected
machines. TLS/DNS are supplied by the customer's reverse proxy. Core MES does
not require public internet access; image acquisition, package installation and
optional external identity/webhook integrations do.

## Production environment contract

Copy `.env.example` to a protected deployment-specific `.env`; do not commit
it. The backend validates production configuration before it starts.

| Class | Variables |
|---|---|
| REQUIRED | `DATABASE_URL` (direct deployments), Compose `POSTGRES_*`, `CORS_ORIGINS`, `PUBLIC_APP_URL`, `PUBLIC_WEB_URL`, `MINIO_*` |
| SECRET | `POSTGRES_PASSWORD`, `JWT_SECRET` (minimum 32 characters in production), `MINIO_ROOT_PASSWORD`, connector machine key, bootstrap admin password |
| OPTIONAL | JWT TTLs, build/version values, connector adapter endpoint and health port, optional explicit legacy module list |
| DEVELOPMENT_ONLY | `SEED_MODE=demo`, `SEED_ADMIN_*`, simulator values and localhost URLs |
| GENERATED | `APP_VERSION`, `BUILD_SHA`, connector key generated from the machine API |

Production rejects placeholder secrets and `CORS_ORIGINS=*`. It does not use
demo seed values. Do not put passwords, tokens, database URLs, connector keys,
or MinIO credentials in tickets or logs.

## Install and initial provisioning

1. Create the protected `.env` from `.env.example` and replace every example
   secret and URL. Set explicit `BOOTSTRAP_*` values for the real company,
   tenant code, first administrator, and plant.
2. Start dependencies only: `docker compose up -d postgres minio minio-init`.
3. Apply migrations once, under an operator change record:
   `docker compose --profile ops run --rm migrate`.
4. Provision the tenant once (safe to repeat with the same tenant code):
   `docker compose --profile ops run --rm provision`.
5. Start application services: `docker compose up -d backend web`.
6. Run the smoke checklist below before handover.

The backend container startup is non-mutating: it never runs Prisma migration
or seed. Provisioning creates the named tenant, initial local ADMIN, one plant,
explicit legacy `ProductModule` states, required HMI/tooling action grants and
an audit record. It creates no customer, material, work order, or machine demo
data. It neither creates nor changes V2 `TenantLicence`/`ProductGrant` data:
legacy `ProductModule`/PagesGuard remains the production authorization
authority.

The initial admin password is only supplied through `BOOTSTRAP_ADMIN_PASSWORD`,
is bcrypt-hashed, and must be at least 12 characters. Replaying the same
provision command is idempotent (including the single creation audit); a duplicate tenant code with another company,
or an email belonging to another tenant, fails closed.

For disposable development/test data only use
`SEED_MODE=demo pnpm --filter @ahkmes/backend exec prisma db seed`. Never use
that command in a customer deployment.

## Start, stop, health, and diagnostics

```
docker compose up -d backend web
docker compose stop backend web
docker compose restart backend web
curl -fsS https://api.example.internal/health/live
curl -fsS https://api.example.internal/health/ready
curl -fsS https://api.example.internal/health/info
docker compose logs --since 30m backend connector
```

`/health/live` reports process liveness. `/health/ready` returns 200 only when
PostgreSQL, migration metadata/schema table and the configured MinIO bucket are
available; it returns a coarse non-sensitive 503 otherwise. `/health/info`
exposes only application version/build identifiers. Request logs contain a
response `X-Request-Id` plus method/path/status/duration and, when available,
tenant/user/machine identifiers; request bodies and credentials are excluded.

With the connector profile enabled, create a machine and generate its key in
the authenticated machine administration flow. The connector sends a protected
machine-key heartbeat. An authorized machine user can read
`GET /machines/:id/connector-status`: adapter, connection state, last success,
last error category, reconnecting/configuration state and a clear qualification
label. `simulator` is **SIMULATED**; M80/Fanuc are **EXPERIMENTAL**, not
production-qualified by this epic. Connector health is intentionally separate
from backend readiness.

## Backup and restore

PostgreSQL database backup:

```bash
DATABASE_URL='postgresql://user:password@db-host:5432/ahkmes?schema=public' \
  BACKUP_RETENTION_DAYS=14 bash scripts/backup.sh /srv/ahkmes/backups
```

The output is timestamped `ahkmes_YYYYMMDD_HHMMSS.sql.gz`; a failed `pg_dump`
fails the command. The script can also use host/port/user variables or
`PG_DOCKER_CONTAINER`. Retention deletion is intentionally explicit and should
match the customer's RPO. Database backup does **not** include MinIO documents;
mirror/version the MinIO bucket separately and test its restore with each DR
exercise.

Never restore over a primary environment without an approved change and a new
backup. Restore into an isolated target first:

```bash
RESTORE_YES=1 PGHOST=restore-db PGPORT=5432 PGUSER=ahkmes \
PGPASSWORD='...' PGDATABASE=ahkmes \
  bash scripts/restore.sh /srv/ahkmes/backups/ahkmes_YYYYMMDD_HHMMSS.sql.gz
DATABASE_URL='postgresql://user:password@restore-db:5432/ahkmes?schema=public' \
  pnpm --filter @ahkmes/backend exec prisma migrate status
```

The tested repository drill is `pnpm test:operations-e2e`: isolated source and
restore PostgreSQL 16 containers, a fresh migration/provisioning run, smoke
data, timestamped backup, restore into the second database, schema status and
login/data/legacy-entitlement validation. It has no host ports or persistent
volumes and cleans itself up.

## Upgrade and rollback decision

1. Announce maintenance and verify `/health/ready`.
2. Take and independently verify a PostgreSQL backup (and the associated MinIO
   backup).
3. Deploy the compatible image/build but do not start a new backend yet.
4. Run `docker compose --profile ops run --rm migrate` once and inspect its
   exit code/log.
5. Start/restart backend and web; run the smoke checklist.
6. If migration fails, stop the rollout. Prisma migrations are forward-only:
   do not claim database downgrade. Choose a forward fix only after assessment,
   otherwise restore the pre-upgrade PostgreSQL and MinIO backup to the prior
   compatible application version.

## Post-deployment smoke checklist

- Web and backend are reachable through their intended URLs.
- `/health/live`, `/health/ready`, and `/health/info` succeed.
- Initial admin login succeeds; an unrelated tenant cannot be read through its
  token/API scope.
- A master-data request and a representative manufacturing request succeed.
- Legacy module configuration is present and V2 is not the runtime authority.
- Connector status can be read for an enrolled machine; offline controller state
  does not fail platform readiness.
- An audited mutation is visible in AuditLog and no startup errors appear in
  backend logs.

## Common failure modes

| Symptom | Operator action |
|---|---|
| Backend exits at startup | Correct the fail-fast production config error; never substitute example secrets. |
| Readiness 503/database | Verify database service, credentials, network, then run `prisma migrate status`; do not use `migrate dev`. |
| Readiness 503/storage | Verify MinIO/bucket/credentials; restore document storage separately if DR is in progress. |
| Provisioning refuses replay | Check tenant code and admin email belong to the intended tenant; do not force cross-tenant reuse. |
| Connector shows NOT_REPORTED | Verify edge process, machine key, backend reachability, then connector loopback `/health` and logs. |
| Migration failure | Stop rollout, keep evidence, decide forward-fix versus restore using the upgrade procedure. |

## Evidence

On 2026-08-12 `pnpm test:operations-e2e` passed against isolated real
PostgreSQL 16: all 65 migrations, controlled provisioning, 2 fresh-install
smoke assertions, timestamped backup, isolated restore, `prisma migrate status`
and 1 restore verification assertion. This is a database/restore drill only;
it is not a CNC controller qualification or a V2 entitlement cutover.
