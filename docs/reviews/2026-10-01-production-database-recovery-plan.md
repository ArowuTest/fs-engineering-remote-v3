# Production database recovery plan — 1 October 2026

Status: read-only recovery assessment complete. **No production database, Railway service, volume, variable, deployment or namespace mutation was performed.**

## Confirmed current condition

The existing production service is named `Postgres` and is online, but Railway structured service configuration shows source image `postgres:17` and no mounted volume. The Railway environment inspection likewise reports `hasVolume:false`.

Read-only CLI checks returned:

- `railway postgres pitr status --service Postgres`: PITR **disabled**, archive bucket **not wired**.
- Railway reports the current `postgres:17` image is not eligible for Railway PITR; supported Postgres images are Railway's `postgres-ssl` and Postgres HA images.
- `railway postgres pitr backup list --service Postgres --json`: fails because the service has **no volume attached**.
- `railway postgres pitr schedule list --service Postgres --json`: same no-volume blocker.

Railway's current documentation states that PITR for supported Postgres images continuously archives WAL to a Railway bucket, maintains rolling base backups, and restores into a new sibling service without touching the source. Volume backup scheduling is a separate capability.

This materially increases the priority of recovery work: the existing database must not be casually redeployed, have its image changed, or be used for a namespace migration until a recoverable copy exists.

## Emergency logical backup captured and restore-proven

A read-only logical safety backup was captured from the current production database before any migration work:

- production database reported approximately **8950 kB**;
- custom-format `pg_dump` archive: **68,088 bytes**;
- SHA-256: `aa3123e73f9d5425b43e3804ac168dcdf40fff5ac6f17032f57295a8af631fdb`;
- remote `pg_restore --list` succeeded;
- the archive was copied into the private ignored V3 `.agent` area with the same SHA-256;
- the temporary copy inside the production container was deleted afterwards;
- the local archive was restored into a disposable PostgreSQL 17 database and validated successfully;
- restored counts: **27 public tables, 1 mission, 1 work item, 1 execution node, 14 node jobs, 13 evidence rows**;
- the disposable verification database was dropped and its local PostgreSQL fixture stopped.

Evidence: `exec-muplloj5-badc224f`, `exec-muplmcpi-d311e927`, `exec-muplnh4i-df7baf8d`, and `.agent/production-backup-evidence-20261001.json`.

This materially improves immediate recoverability, but it is **not** a substitute for managed persistent storage, an off-device backup policy, PITR, scheduled backups, or a Railway-side restore drill.

## Existing state that must be preserved

The 29 September read-only namespace inventory remains authoritative for known application state:

- 30 non-empty instance-scoped rows, all under `v3-staging`.
- one mission, one worker item, one execution node, fourteen node jobs and thirteen evidence rows.
- fourteen node jobs and thirteen evidence rows reference missing historical mission identifiers.
- global account state contains one user, one workspace and one membership.
- no queued/leased work was present at that observation.

Those legacy records are not automatically customer data, and their missing-parent provenance is unresolved. A recovery migration must preserve them byte/logically until an explicit disposition is accepted.

## Safe migration strategy

### Gate 0 — source and operations freeze

Before the database migration window:
1. Integrate only source that has passed the required acceptance boundary.
2. Confirm exact deployed control-plane/worker revision and node protocol compatibility.
3. Block new mission dispatch for the short final-copy/cutover window.
4. Confirm no queued or leased work and no unresolved side-effecting job in `recovery_required`.
5. Record row counts, schema fingerprint and current namespace inventory.

### Gate 1 — make an independent logical backup before touching the service

Because the source has no Railway volume/PITR protection, take a logical PostgreSQL backup from the running database **before any image, volume, namespace or service-variable change**.

Required properties:
- custom-format `pg_dump` (or equivalent complete logical export);
- encrypted/restricted destination outside the running container;
- SHA-256 and byte size recorded;
- `pg_restore --list` succeeds;
- database/schema/version metadata recorded;
- no secrets printed into logs or review evidence.

The dump must be restored into a disposable database and validated before it is treated as a backup.

### Gate 2 — provision a sibling supported Postgres service

Do not convert the current source in place first.

Provision a **new sibling** PostgreSQL service using Railway's supported Postgres image/template and persistent storage. Keep the old service untouched and serving until the sibling passes validation.

The sibling must initially be isolated from production application traffic.

### Gate 3 — restore and validate

Restore the verified logical backup into the sibling.

Minimum validation:
- schema/object inventory matches;
- expected row counts match;
- the 30 known legacy instance-scoped rows remain present;
- missing historical mission references remain preserved rather than silently rewritten;
- account/workspace rows match;
- node credential hashes/generations are preserved;
- indexes/constraints/migrations are valid;
- application migrations are idempotent;
- a control-plane copy can start against the restored DB;
- two-workspace isolation and credential negative tests pass against the restored DB;
- no production node is allowed to claim work from the rehearsal environment.

### Gate 4 — enable recovery on the sibling

After restore validation, enable the supported recovery mechanisms on the sibling:
- attach/confirm persistent volume;
- enable PITR;
- verify archiver health;
- wait for initial recoverable coverage;
- configure explicit volume-backup schedule/retention appropriate to the service tier;
- create an on-demand pre-cutover backup.

Do not infer success from configuration alone: verify the backup/PITR status command reports usable coverage.

### Gate 5 — actual restore drill

Use PITR or a volume backup to create/restore a **non-production sibling/fork**. Validate schema and sentinel counts against the source backup.

Record:
- backup/target timestamp;
- restore duration;
- resulting service health;
- row/schema verification;
- any recovery-point gap;
- cleanup plan.

Do not perform an in-place restore of the production source for the drill.

### Gate 6 — controlled application cutover

Only after the recovery drill:
1. pause mission dispatch;
2. take a final logical/on-demand backup;
3. copy any delta required by the selected migration method;
4. point **both control-plane and autonomous-worker** to the new database in one controlled rollout;
5. retain the existing `FS_REMOTE_INSTANCE_ID=v3-staging` during the database cutover unless a separately rehearsed namespace migration is approved;
6. verify `/readyz`, exact serving SHA, worker heartbeat, node heartbeat, account/OAuth access, row counts and a fresh harmless mission;
7. confirm no duplicate unsafe side effects;
8. retain the old database unchanged for a defined rollback window.

Database migration and namespace normalization should be separate changes. Combining them would make rollback and provenance diagnosis unnecessarily ambiguous.

### Gate 7 — rollback criteria

Rollback application traffic to the old database if any of the following occurs:
- readiness or database health fails;
- control-plane/worker revisions diverge;
- worker or node credentials stop authenticating;
- row-count/reference checks differ unexpectedly;
- tenant isolation fails;
- mission/evidence continuity is incoherent;
- recovery status on the new database is not healthy.

Do not delete the old service during the initial cutover.

## Namespace decision after recovery is proven

Only after the sibling database is recoverable and the cutover path is rehearsed should the team decide whether `v3-staging` remains an internal stable instance identifier or is migrated to `v3-production`.

If renamed, rehearse the namespace change on a restored copy and validate every instance-scoped table, parent reference, node identity and credential path. A cosmetic environment label mismatch is lower risk than losing durable state.

## Acceptance required before external users

Production database recovery is not closed until:
- a verified backup exists;
- a restore succeeds into a disposable/sibling database;
- PITR/backup coverage is active on the production target;
- cutover and rollback procedures are timed and evidenced;
- legacy references and namespace handling have an explicit disposition;
- operational alerts cover backup/recovery health.

This plan deliberately performs **no** production mutation. The first production-changing step—creating/provisioning the replacement recovery-capable database or enabling recovery—remains a controlled delivery boundary.
