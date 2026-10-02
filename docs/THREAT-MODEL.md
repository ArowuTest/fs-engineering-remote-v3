# FS Engineering Remote V3 — threat model

Updated: 1 October 2026.

Status: implementation-derived security model for pre-beta acceptance. A control listed as implemented is not automatically penetration-tested or production-accepted.

## Security objective

V3 must let authorized workspace users coordinate engineering work against customer-controlled execution nodes without allowing one workspace, user, node, model provider, repository or failed worker to acquire authority it was not granted.

Deterministic policy, database ownership predicates, lease fencing and observable execution evidence remain authoritative. Model output, portable memory and learned experience are not security authority.

## Assets

Primary assets include:

- customer source repositories and local files;
- filesystem/process/Git/browser/database execution authority on enrolled nodes;
- workspace identity, membership and role state;
- node and OAuth credentials;
- provider API credentials;
- missions, work items, node jobs and approvals;
- deterministic verification/evidence and council records;
- audit and usage/accounting records;
- production PostgreSQL state and backups;
- deployment revision and operational availability.

## Trust boundaries

### Browser / ChatGPT / external harness → V3 control plane

Untrusted request input crosses authentication, OAuth scope, workspace and role boundaries before reaching engineering operations.

### V3 control plane → customer execution node

The control plane dispatches a scoped node job. Node identity, workspace ownership, protocol/readiness compatibility, project/capability policy and a leased job credential bound to one job constrain execution.

### V3 → hosted model/reviewer provider

Prompts and selected context leave V3 for the chosen provider. Provider output is untrusted advisory/review material and cannot itself establish deterministic execution success.

### V3 → GitHub / other explicit external APIs

Credentials and request data cross into the external service only when the corresponding integration is invoked.

### Control plane / worker → PostgreSQL

PostgreSQL is the durable authority for hosted mission/work/evidence/identity state. Workspace predicates and transactional fencing are required at mutation boundaries.

### Local runtime → filesystem state

Local-mode missions, work and evidence can be persisted on disk. Cross-process mutation must be locked and corrupt/ambiguous state must fail closed rather than disappear.

## Threats and current controls

| Threat | Current source-backed controls | Remaining acceptance |
|---|---|---|
| Cross-workspace read/write | Workspace-scoped stores/routes, parent/workspace validation, OAuth scope checks, two-workspace negative tests. | Repeat against deployed production topology and penetration test. |
| Privilege escalation | Role allowlists, owner-preservation rules, admin restrictions around owners, current-role checks on active sessions. | Threat-led API fuzzing and deployed role matrix. |
| Stolen/reused auth token | Opaque-token hashing, expiry/revocation, membership/account status checked on resolution. | Retention/cleanup policy, session/device UX, incident procedure. |
| Provider credential disclosure | AES-256-GCM envelope at rest, secret not returned by account list APIs. | Key rotation/recovery procedure and secret-store operational review. |
| Node credential theft | Hash-only server storage, bounded enrollment, rotation with proof-of-possession, immediate revocation, generation tracking. | Physical node incident drill and deployed rotation/recovery test. |
| Node ID takeover | Create-only registration and workspace-bound node access; colliding ID cannot replace owner/credential. | Deployed hostile-enrollment test. |
| Stale worker/node lease writes | Lease owner/token, expiry checks and transactional updates; stale owner cannot complete after lease loss. | Real disconnect/lease-expiry/reconnect drill. |
| Duplicate side effects after uncertain failure | Replay-safe classification; side-effecting work enters `recovery_required`; explicit inspected retry required. | Real external side-effect drill proving no automatic duplicate. |
| Concurrent local queue claim | Cross-process filesystem lock and atomic local completion record. | Stress/reliability soak on supported platforms. |
| Completion/evidence mismatch | Execution result now carries authoritative `executionId`; atomically-created evidence carries same ID; acceptance requires matching passing evidence. | Full current-source gate and independent review. |
| Evidence forgery by caller | Caller evidence endpoint restricted to non-authoritative annotation/info/unknown; deterministic sources assessed separately. | Pen-test alternative write paths and DB privilege assumptions. |
| Model opinion masquerading as proof | Reasoning/council evidence excluded from deterministic execution proof; deterministic policy remains authoritative. | Independent security review of all acceptance paths. |
| Reviewer prompt injection / source exfiltration | Bounded review packets, credential-shaped material preflight, source/evidence provenance, fixed failure handling, independent finding/adjudication structures. | Provider/data-flow review; adversarial prompt corpus. |
| Paid model spend without consent | Free-first benchmark routing and explicit paid-consent boundary. | Provider billing/limit monitoring in deployed beta. |
| Provider/model outage | Provider/model error classification, cooldown/circuit behavior, qualified fallback and fail-closed review when no accepted reviewer completes. | Live multi-provider reliability; current free-only OpenRouter auth issue remains. |
| Path traversal / symlink escape | Root confinement, traversal checks, secret-path restrictions and symlink escape regression tests. | Platform-specific filesystem adversarial tests on Linux/macOS. |
| Dangerous command/system action | Command policy blocks high-risk administration operations while normal engineering commands remain allowed. | Malicious-repository command-injection testing. |
| Browser SSRF/private network access | Browser navigation scheme/private-network restrictions and bounded sessions/buffers. | Dedicated SSRF bypass testing. |
| OAuth misuse | Redirect-bound authorization code, single-use/expiry/hash-only code/token state, scope allowlists and connection revocation. | CSRF/state and redirect fuzzing against deployed endpoints. |
| Error/secret leakage | Fixed public errors on hardened node/operator routes; lease/node/provider secret fields removed from ordinary views. | Whole-API error-fuzz/redaction audit and log review. |
| Hosted state silently falling back to ephemeral disk | Hosted/Railway durability guard requires database before startup. | Deployment fault injection. |
| Database loss | Emergency verified logical backup now exists. | Persistent supported Railway DB, PITR/backups and real restore drill remain mandatory. |
| Stale/wrong deployment | Deployment identity exposed; exact-revision workflow guards exist. | Real partial-rollout/rollback exercise. |
| Worker silently dead | Session-fenced durable heartbeat and operator telemetry. | Deploy and alert against real stale-worker fault. |
| False operational health | Operator API distinguishes observed from unobserved signals and does not fabricate zero/false metrics. | Connect external Railway/node-rate signals and exercise alerts. |

## Malicious repository model

A repository must be treated as untrusted input.

Files, package scripts, build definitions, test fixtures, generated output and repository documentation can attempt to:

- induce secret reads;
- escape configured roots;
- invoke destructive commands;
- alter agent instructions;
- create oversized output/context;
- forge evidence-like text;
- cause network calls;
- exploit build/test dependencies.

Repository text is context, not policy. It does not override root restrictions, command policy, workspace authority, approval boundaries, deterministic evidence requirements or explicit user authorization.

Pre-beta security work must include a malicious-repository fixture that exercises these boundaries rather than only benign project tests.

## Model/provider trust model

Models can propose plans, remediation and review findings. They cannot:

- mint workspace/node authority;
- grant paid consent;
- convert arbitrary evidence into deterministic proof;
- make an unsafe operation replay-safe;
- approve their own execution side effects;
- override a failed deterministic gate.

A council approval is a review artifact, not a replacement for execution evidence.

## Availability and recovery threats

Security includes preserving state and preventing ambiguous replay.

The current production PostgreSQL service has a separately documented recovery blocker: it lacks a persistent Railway volume/managed backup/PITR configuration. A verified logical safety dump exists, but launch requires migration to a recoverable sibling and a restore/rollback drill.

Worker/node disconnects must preserve lease fencing and distinguish replay-safe from uncertain side-effecting operations.

## Open pre-beta security gates

The following remain required:

1. current-source independent review when an authorized free reviewer path is available;
2. malicious-repository/path/command/prompt-injection test campaign;
3. deployed two-workspace isolation and role matrix;
4. deployed node credential compromise/rotation/revocation drill;
5. real disconnect/lease-loss/no-duplicate-side-effect recovery drill;
6. database restore and rollback rehearsal;
7. whole-API error/redaction review;
8. OAuth CSRF/redirect/scope fuzzing;
9. physical Linux and macOS node security/permission tests;
10. explicit data-retention/deletion implementation;
11. dependency/container/deployment supply-chain review;
12. controlled external beta with monitoring and incident-response ownership.

## Acceptance rule

A threat is not marked closed because a model says it is safe or because a unit test passes. Closure requires the evidence appropriate to the boundary: source tests, real PostgreSQL concurrency tests, physical-node tests, deployed fault injection, restore drills, adversarial testing and independent source review where required.
