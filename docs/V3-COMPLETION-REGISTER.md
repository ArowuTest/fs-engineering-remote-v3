# V3 completion register

Updated: 1 October 2026. Source candidate: `fix/v3-independent-review-20260929`, based on `65fd28e2f9c8c6e34bbf762f52aabdd7d6d6f578`.

Purpose: finish the existing V3 product, rather than expand V2B into another control plane or launch a new assistant interface. This register separates implemented source, verified behavior, deployment and customer acceptance.

## Product boundary retained

V3 is a harness-neutral hosted engineering control plane with customer-local execution by default. Missions, evidence, policy, skills and experience belong to the platform. Deterministic policy remains authoritative; learned providers remain shadow/advisory. Optional sandbox and hosted repository-code execution remain contained until their full isolation/durability contracts are accepted. They are not removed from the product vision or counted as finished.

V2B remains the maintained single-machine runtime. Its accepted repairs may be merged separately without waiting for every V3 feature. Existing V2B project execution must not be disrupted by V3 work.

## Closure sequence and evidence

| Area | Current state | Next measurable acceptance |
|---|---|---|
| V2B maintenance merge | **Accepted and fast-forward merged** to local main: routing `c40c6e9`, literal edits `a4d1042`; final 341/341 tests and TypeScript pass. | Running-service activation remains separate; drain/check active project work first. No Git remote is configured, and no push or restart was performed. |
| V3 core repair merge | **Current exact-source gate: 676/676 main tests + 73/73 PostgreSQL + TypeScript PASS** (`exec-muq3g0in-dc644b6c`, `exec-muq3egpy-d1919f78`). Local cross-process queue locking/atomic completion, node credential lifecycle, atomic quota admission, tenant isolation, durable worker telemetry, operator status, and execution/evidence identity correlation are implemented/tested. Current-source independent acceptance remains outstanding because the authorized free-review route is failing provider authorization. Earlier scoped approvals are not whole-candidate acceptance. | Close current-source independent review when an authorized qualified free route is available, then integrate only accepted work. Production recovery/resilience/customer-beta gates remain separate from source integration. |
| Production state inventory | Read-only inventory complete; 30 legacy instance-scoped rows in v3-staging; missing parent mission references recorded. | Preserve and reconcile provenance, backup/restore rehearsal, accepted retain/migrate decision. No cosmetic variable rename. |
| Windows end-to-end mission resilience | Existing node connected; local disposable PG + actual node journey tests exist. | After accepted rollout, exercise real Railway disconnect, lease expiry, reconnect, failure and inspected unsafe recovery; prove coherent evidence. |
| Worker/operator observability | **Implemented/tested in candidate:** durable session-fenced worker heartbeat, restart count, deployment revision, DB latency, work/node queue counts, recovery-required count, expiring leases, last successful work and node lifecycle summary; `operator_status` now attaches durable production telemetry where available. | Source acceptance, deployed verification and alert/threshold wiring remain before launch acceptance. |
| Alerts and support path | **Foundation implemented/tested:** deterministic alert evaluation covers observed readiness/DB/worker/recovery/node-compatibility/revision conditions and configured thresholds. The owner/admin operator API explicitly labels Railway deployment/restart and node rate-window signals as `not_observed` rather than inventing healthy zeros. No notification provider has been invented. | Wire/configure real signal sources for currently unobserved conditions plus a recipient/transport and explicit thresholds, source-review the tranche, then exercise alerts against deployed/nonproduction faults. |
| Authentication and tenancy | **Implemented/tested in candidate:** two-workspace negative isolation, current-role enforcement, multi-workspace account-status safety, node credential rotation/revocation with audit rollback, enrollment and scoped account routes. | Current-source review plus deployed two-workspace/credential lifecycle verification and documented threat model. |
| Recovery and deployment | **Critical recovery blocker confirmed 1 Oct:** current production `Postgres` uses `postgres:17`, has no attached volume, no volume backups/schedule and PITR is disabled; Railway reports this image cannot enable PITR. **Emergency logical backup is now captured and restore-proven locally** (SHA-256 `aa3123…31fdb`; restored counts match known mission/work/node-job/evidence inventory). Exact-revision guarded app rollout still exists. Recovery plan: `docs/reviews/2026-10-01-production-database-recovery-plan.md`. | Preserve the verified dump, provision/restore to a supported persistent sibling, enable PITR/backups there, perform a Railway-side restore drill, then rehearse cutover/rollback before external users. Do not mutate the current database casually. |
| Linux / macOS | Cross-platform source/CI contracts, not physical-machine acceptance. | Enroll and run actual Linux, then macOS nodes through the same lifecycle and recovery tests. |
| Onboarding and cross-harness continuity | Product journey specified; acceptance not inferred from available tools. | A new user enrolls a node and finishes useful work; a second harness resumes the same workspace/mission with accurate branch, checks and approvals. |
| Usage, quotas, audit and retention | **Implemented/tested in candidate:** atomic local-node concurrency/daily admission, hosted-work active usage counting, audited owner/admin mutations and credential lifecycle. Implementation-derived data-flow/retention truth is documented in `docs/DATA-FLOW-RETENTION.md`; tenant-scoped ephemeral credential cleanup is implemented/tested (`RetentionLifecycle.cleanupEphemeralCredentials`, PostgreSQL 75/75 in `exec-muqxw4z5-3ae57b0b`); no unsupported durable-retention period is claimed. | Approve retention/deletion periods, implement lifecycle cleanup/deletion controls, rehearse them against restored data, and publish the reviewed customer-facing policy. |
| Optional execution targets | Policy disabled, not functional completion. | Implement restricted immutable materialization, isolation, scoped credentials, common results, durable evidence/accounting and recovery before enabling. |
| Decision/experience | Shadow implementation; no learned production authority granted. | Accumulate accepted causal evidence; use existing held-out calibration, abstention, project separation and promotion/revocation gates. |
| Controlled beta | Not open for external users. | Complete essential safety/recovery/onboarding gates, define supported scope, then measure actual external repeated use and operator effort. |

## Current delivered and reviewed boundaries

V2B is now a completed local integration, not a blocker requiring another general authorization. Its live PID 21324 was deliberately not restarted, so merged source must not be described as active in the running MCP. The existing sessions, queued work, ports and root permissions remain unchanged.

The new V3 runtime guard rejects a declared hosted/Railway process without a database before configuration, ownership, migrations, listeners or worker loops begin. A present connection string is not a substitute for database health: existing migration/readiness checks still apply. Local developer mode remains distinct from the hosted control plane, and customer-local job execution does not imply filesystem-backed production control-plane state.

The mission scanner now reserves each mission before asynchronous readiness, preventing overlapping scans from launching duplicate in-process supervisors. Failure evidence uses a fixed public label, the authoritative workspace and reservation cleanup. A separate accepted literal-edit correction preserves replacement text exactly, including dollar metacharacters.

These scoped approvals do not waive the original V3 source-review findings or the product's production launch gates. See `docs/reviews/2026-09-29-runtime-boundaries-acceptance.json`; it records exact source hashes, explicit partial-file review limits and fresh test-log hashes. `.agent/v3-acceptance-coverage.json` is a review-routing aid, **not a completion percentage**.

The original four repair groups are now implemented and deterministically exercised in the candidate, including authoritative persistence/leases, node dispatch/recovery, authentication/tenancy, quota admission and execution/evidence identity correlation. Remaining work is no longer broad backend construction: current-source independent acceptance, recovery-capable production data infrastructure, deployed resilience/security exercises, retention/deletion implementation, physical Linux/macOS validation and external onboarding/beta evidence. Reuse completed reviews only where exact source/context seals match.

## Evidence references

- V2B baseline reconciliation: `exec-muml2fzp-8dd66356` (four pre-existing failures reproduced).
- V2B original repaired full suite: `exec-muml6wjh-d54a5a12` (266/266, historical); final accepted routing 337/337, then accepted literal-edit full gate 341/341, recorded in the V2B repository acceptance receipts.
- V3 new worker-ownership RED: `exec-mumlmjq7-1411b498` (three new failures, original fifteen PG tests pass).
- V3 worker-ownership GREEN: `exec-mumlouen-4b3fe2c3` (18/18 PG tests, TypeScript pass).
- Production inventory: `exec-mumlcmof-57b1abf3` and `exec-mumlgduo-26103725` (read-only transactions verified).
- Detailed repair scope: `docs/reviews/2026-09-29-independent-review-remediation.md`.
- Detailed production inventory: `docs/reviews/2026-09-29-production-namespace-inventory.md`.
- Production recovery plan: `docs/reviews/2026-10-01-production-database-recovery-plan.md`; restore-proven emergency dump evidence: `.agent/production-backup-evidence-20261001.json`.
- Data-flow/retention truth: `docs/DATA-FLOW-RETENTION.md`; threat model and open security gates: `docs/THREAT-MODEL.md`.
- Current execution/evidence correlation RED: `exec-muq3bgcr-2759dfb8`; targeted GREEN: `exec-muq3dbrp-24a522a3`; PostgreSQL GREEN: `exec-muq3egpy-d1919f78` (73/73).
- Current full exact-source gate: `exec-muq3g0in-dc644b6c` (676/676 main tests plus TypeScript PASS).

- Historical V3 source gate: `exec-mun8hg3b-fd526105` (597/597 main tests, 31/31 PostgreSQL, TypeScript pass).
- V3 runtime/scanner scoped council: `council-1790719731573-9aa195` (approved, zero unresolved findings or failed dimensions).
- Shared literal-edit scoped council: `council-1790719189859-04ffee` (approved; exact method scope recorded).

## Release discipline

A green test suite does not substitute for required independent review. A completed model call does not constitute council approval. A green readiness endpoint does not establish that unmerged code is deployed. Preserve exact SHA/hash evidence at every accepted boundary and do not count contained optional features as delivered functionality.

## Persistence continuation — 29 September 2026

The supplied PostgreSQL source scope is independently approved. The full V3 branch is still unaccepted and uncommitted.

Four concrete repairs were test-first: cancellation preserves an existing recovery_required state; generic work snapshot save validates parent mission/step/instance/workspace and cannot overwrite a different work identity; snapshots cannot overwrite prior/active execution; ordinary unscoped work reads no longer expose lease tokens. Cancellation produced 2 local and 3 PostgreSQL REDs; parent-save produced 8 PostgreSQL REDs; lease snapshot/read tests produced another 8 PostgreSQL REDs. Final TypeScript, main600/600, targeted10/10 and PostgreSQL52/52 all pass.

Receipt: `docs/reviews/2026-09-29-persistence-continuation.json`. Final gate `exec-muna8w5k-cec4b4cd`; review `council-1790723413839-2ed89e`. The original file-backed facade, node, authorization, execution-quota and orchestration source-review boundaries remain open. Production and live V2B were not changed.

## Local state and node protocol continuation — 30 September 2026

Current full gate: `exec-munz5y8t-fdb33b11` exited 0; TypeScript passed, main **659/659**, real PostgreSQL **52/52**, no failures, cancellations or skipped tests. Node-focused gate passed **34/34** and local-focused gate **40/40** (subsets, not additional full-suite totals). Added **59 tests**: 30 local-parent/read cases, 16 node self-service cases and 13 node-admin/domain/error cases. Existing worker/executor fixtures now create real parent missions; their original lease/retry/tenant assertions remain.

Local work, evidence and handoff writes now validate the real parent mission/step and inherit its workspace. Local record identity, parent field types and mission step structure are checked. Corrupt mission/work/evidence/handoff reads are explicit failures rather than empty success. Previously unassigned history is preserved byte-for-byte and raises `LOCAL_STATE_RECONCILIATION_REQUIRED`; no ownership is silently assigned and no historical data is migrated. Valid owned legacy records and existing foreign-workspace evidence filtering remain supported.

Node self-service and admin operation handlers now use fixed typed errors. Malformed input is 400, invalid credentials 401, ownership/project denial 403, missing node 404, lifecycle/recovery/idempotency conflicts 409 and unavailable services 503. Raw database/exception text is not emitted by these operation responses. Missing or blank admin secrets cannot authenticate; configured admin authentication uses constant-time fixed-length hash comparison. An invented typed error code falls back to a fixed unavailable-service response. A local Fastify regression proves varying X-Forwarded-For does not bypass the current non-trusting request buckets; actual production proxy/NAT and distributed limits are still not launch-accepted.

Review status: **current local-parent and node-protocol scopes are not independently accepted**. Paid and free review attempts, malformed responses, failed dimensions and source seals are retained in `.agent/local-node-review-20260930`. The last free-only source councils were `council-1790765074646-4a7b62` and `council-1790765074715-38f41a`; both failed closed because required reviewers/adjudication did not complete. Earlier reviews are not reused as approval of later source edits. The paid ledger remains capped at **USD12**: provider-reported **USD9.19553228553**, maximum liability including uncertain reservations **USD11.90410408553**. No paid review jobs remain running or additional spending is assumed authorized above that ceiling.

Receipt: `docs/reviews/2026-09-30-local-state-node-protocol.json`. Earlier `src/pg-state.ts` accepted bytes remain unchanged at SHA256 `4f9830f2698ed7abc7292abc1abd79b215c6ad2f2f8b3d058a9193e01dfa8f59`; related facade source hashes changed, so the prior mixed manifest is not claimed unchanged.

Implemented/tested since this historical tranche: file-backed cross-process lease/concurrency and atomic completion, node credential rotation/revocation, auth/tenancy isolation, atomic quota admission, durable worker/operator telemetry, operator alert-rule foundation, and execution/evidence identity correlation. Still open at launch level: current-source independent acceptance, production legacy-state disposition, recovery-capable Postgres/PITR/restore/rollback, deployed fault/alert exercises, approved retention/deletion lifecycle, physical Linux/macOS nodes, malicious-repository/security testing, cross-harness onboarding and controlled beta evidence. No V3 files are staged/committed/merged/pushed/deployed; live V2B and Railway application revision remain unchanged.


## Malicious-repository and child-process credential boundary — 2 October 2026

Current full source gate: `exec-muqod68p-76cbf1d2` exited 0; TypeScript passed, main **684/684**, no failures, cancellations or skipped tests. Current real PostgreSQL gate: `exec-muqojrez-7b75a105` exited 0; TypeScript passed, PostgreSQL **73/73**, no failures, cancellations or skipped tests. Targeted malicious-repository/credential-boundary gate: `exec-muqocdiv-ac00be51` exited 0; TypeScript passed, **27/27** targeted tests.

This tranche closed concrete source-backed credential and instruction-boundary issues: repository command execution no longer inherits host provider/API/database/cloud credential variables or SSH-agent authority; durable long-running command sessions use the same sanitized environment; local shadow decision subprocesses no longer inherit host secrets while still allowing explicit non-sensitive configured environment values; hosted Git no longer clones using a token-bearing remote URL, resets the remote to a clean URL, uses ephemeral Git extra-header auth only for clone/fetch/push, and runs repository verification with a sanitized environment; repository `AGENTS.md` / `.agent/instructions.md` content is exposed as useful guidance but explicitly labelled `untrusted_context` and `instructionBearing:false` in both `applicable_instructions` and compact `engineering_context`.

This is not a claim that local command execution is an OS sandbox. A configured command root can still run project scripts with normal filesystem authority inside that root and ordinary build environment. Remaining launch-level security work still includes an adversarial/malicious-repository campaign, dependency/supply-chain review, deployed fault/security drills, retention/deletion implementation, physical Linux/macOS node validation, and independent current-source review once an authorized free reviewer route is available. No files were staged, committed, merged, pushed or deployed; live V2B, Railway application revision and production database were unchanged.


## Command metadata redaction final gate — 2 October 2026

Current exact-source full gate after command/session metadata redaction: `exec-muqosrfr-f22a2f8f` exited 0; TypeScript passed, main **685/685**, no failures, cancellations or skipped tests. Current real PostgreSQL gate: `exec-muqoz6ai-3c9447f3` exited 0; TypeScript passed, PostgreSQL **73/73**, no failures, cancellations or skipped tests. Expanded credential/redaction targeted gate: `exec-muqos4bk-16850161` exited 0; TypeScript passed, **28/28** targeted tests.

The previous credential-boundary tranche also now redacts command-line token/secret/password/API-key-like material from returned and persisted process/session metadata. This protects session listings, polling responses and telemetry metadata from obvious command-line secret leakage while preserving the exact command used for execution. It does not claim perfect arbitrary-secret detection and does not convert repository commands into an OS sandbox.

No files were staged, committed, merged, pushed or deployed. No production database writes were performed. V2B and the live Railway application revision were not restarted or modified. Independent current-source acceptance remains blocked under the free-only review policy because the currently available free-review route is OpenRouter-backed and returns `authorization_denied`.


## PR branch CI closure - 2 October 2026

PR #1 (`fix/v3-independent-review-20260929`) is pushed and GitHub CI-green on current HEAD `c0f64080eb215c8575983df52ed55fb608ce35fa` (`fix: preserve same-timestamp evidence order`). GitHub Actions workflow `ci` run #102 / run id `37061623368` completed with conclusion `success`.

The production-readiness candidate was locally green before PR CI fixes: TypeScript + main **685/685**, PostgreSQL **75/75**, and local queue/lock stress **35/35**. GitHub then exposed two cross-platform contract issues, both fixed and pushed: `4ca9a2e` canonicalized vendored Laya hashes across CRLF/LF checkouts, and `c0f6408` preserved local evidence append order when sequential records share the same millisecond timestamp on fast Linux runners.

This records source/test closure for the pushed PR branch only. It does not merge, deploy, restart V2B, or mutate Railway/production DB. Independent current-source review and production DB recovery/PITR remain open launch blockers.
