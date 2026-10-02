# FS Remote V3

FS Remote V3 is a harness-neutral engineering control plane with customer-local execution as the default. It coordinates workspaces, users, execution nodes, missions, workers, verification evidence and engineering knowledge. It is not a replacement chat interface and is not Windows-only.

## Current implementation

- **Control plane:** Node.js 22, TypeScript and Fastify; `src/index.ts` → `src/http.ts`. MCP, compact authenticated Actions, node protocol and account/administration routes share governed services.
- **Worker:** `src/executor-main.ts`. Coordinates reasoning, verification and review work. PostgreSQL is authoritative for hosted missions, leases, evidence and handoffs.
- **Customer node:** `src/node-main.ts`. Outbound authenticated HTTP polling, enrollment, readiness/version reporting, lease renewal and local tool execution. Windows, Linux and macOS contracts exist; physical-platform acceptance is separate from CI.
- **Database:** PostgreSQL through `pg` and explicit SQL in `src/db.ts`, `src/multi-user-schema.ts` and the state stores. There is no Prisma ORM in this checkout.
- **Portal:** server-generated HTML/JavaScript in `src/portal.ts`, not React.
- **Decision/experience:** deterministic governance remains authoritative. Learned outputs are shadow/advisory. Workspace experience caches have durable evidence records; a learning outcome is not authorization.

## Release boundaries

The local target remains enabled. Optional sandbox and hosted **repository-code execution** are currently policy-disabled in `src/execution-release.ts`. The adapters remain in source, but their isolation, workspace-scoped durability and result/accounting acceptance are not complete. A healthy endpoint or environment flag must not bypass this release boundary. Hosted coordination/reasoning/review workers are not disabled by this restriction.

A green `/readyz` checks declared serving dependencies; it is not proof that all security, recovery or product launch gates have passed. No external-user production acceptance is implied by this README.

## Engineering and verification

```sh
npm ci
npm run check
npm test
npm run node:doctor
```

`build` is a type check (`tsc --noEmit`); execution uses `tsx`. Use stable durable session IDs and bounded polling for long checks. Never represent a command timeout, nonzero exit, missing evidence or a completed reasoning request as successful engineering execution.

### Real PostgreSQL and node journey gate

Provision a **disposable, loopback-only** PostgreSQL instance with user `fs_review` and database `fs_v3_review`. Supply its URL through `FS_REVIEW_PG_URL`, then run:

```sh
npm run test:postgres
```

The suite rejects non-local and non-review targets. It creates a randomized schema and removes only that schema afterwards. Tests cover database-backed tenant isolation, lease races, transactional evidence, OAuth enrollment and a real child node executing passing/failing commands. The council opinion in that journey is a deterministic test fixture, not an independent production review.

The ordinary suite intentionally does not discover production database credentials. CI and the guarded deployment workflow run the PostgreSQL journey gate separately before deployment mutations.

## Trust boundaries

Workspace OAuth operations require both token scopes and the principal's current role. Host-wide credentials and executor lease authority are not delegated to workspace users. Workspace-bound direct roots require an explicit `workspaceId`; processes and browser sessions are isolated by workspace. The legacy operator secret remains a separate privileged boundary and must never be issued as an ordinary workspace credential.

Filesystem traversal and in-root symlink/junction escapes are rejected. Trusted shell execution is **not an operating-system sandbox**. Do not host mutually untrusted repositories and service credentials in one unrestricted execution process.

Expired side-effecting node/worker work requires explicit inspected recovery; caller-supplied `__verification` metadata cannot make an arbitrary command replay-safe. Evidence, accounting and completion are committed under the valid database lease in one transaction.

## Repository and deployment discipline

Only accepted coherent changes may be committed. Push and deployment require the applicable delivery authorization. Preserve existing work; no reset/clean/force operations or production-destructive changes without explicit approval.

The Railway deployment definition is `.railway/railway.ts`. Keep control plane and worker on an exact verified revision. The plan guard rejects unexpected/destructive infrastructure changes and protects Postgres. Do not casually rename the durable `FS_REMOTE_INSTANCE_ID`; inventory existing state first.

V3, V2B, V2C and legacy V2 remain distinct products/runtimes. On the existing development host, V3 uses 8766, V2B 8767 and legacy V2 8768. Do not collapse their processes, state roots or watchdogs.

## Key references

- `docs/V3-ARCHITECTURE.md` — architecture boundaries.
- `docs/RAILWAY-DEPLOYMENT.md` — guarded deployment.
- `docs/reviews/2026-09-29-independent-review-remediation.md` — repair findings and remaining acceptance boundaries.
- `agent/FS-REMOTE-DEVELOPMENT-INSTRUCTIONS.md` — governed execution and evidence discipline.
- `docs/FS-DECISION-ARCHITECTURE.md` — deterministic/shadow decision boundary.
- `docs/archive/README-v2-baseline.md` — historical pre-V3 README; not current operating instructions.
