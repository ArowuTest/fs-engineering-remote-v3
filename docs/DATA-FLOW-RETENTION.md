# FS Engineering Remote V3 — data flow and retention contract

Updated: 1 October 2026.

Status: implementation-derived launch contract. This document describes what the current V3 source does and explicitly identifies policy that is **not yet implemented or approved**. It does not substitute for a privacy notice, legal review, provider agreement or customer-specific data-processing terms.

## Product boundary

V3 is local-execution-first, not local-data-only.

By default, repository commands, filesystem operations, Git operations, browser automation and other engineering actions execute on the enrolled customer node. The hosted control plane coordinates missions, work, evidence and identity. When a hosted reasoning/review provider is used, the prompt/context supplied to that provider necessarily leaves the customer node/control plane boundary.

V3 must therefore never advertise “your code never leaves your machine” as a universal claim.

## Data flow

### Customer execution node

The node can receive governed jobs containing the project identifier, operation/capability and operation payload required to perform the requested work. Depending on the operation, that payload can include paths, commands, edit material, Git parameters, browser targets or verification instructions.

Execution happens on the enrolled node. The node returns a bounded result plus usage/evidence to the control plane. Current node completion evidence includes the node/job identity, project, capability, operation and result data needed for durable engineering evidence.

Node credentials are not stored in plaintext by the control plane. The database stores credential hashes. Enrollment/rotation returns a newly issued secret to the caller so it can be persisted by the node. Rotation and revocation state is durable.

### Hosted control plane and PostgreSQL

The durable control plane currently persists records including:

- users, workspaces and memberships;
- invitations, user sessions and password-reset records;
- OAuth connections, authorization codes and access-token records;
- provider credentials and model preferences;
- missions and mission steps;
- work items and node jobs;
- execution nodes and enrollment state;
- evidence, handoffs, approvals and council runs;
- audit events;
- execution usage/accounting;
- workspace quotas;
- worker runtime/heartbeat telemetry.

Authentication/session/reset/OAuth/enrollment bearer material is stored as a hash where the current implementation uses opaque tokens.

Provider API credentials are stored as an AES-256-GCM encrypted envelope using the configured V3 provider-secret encryption key. Account APIs do not return the stored secret envelope.

The system also maintains bounded local runtime state where local mode is used, including mission/work/evidence/handoff state and execution-session/performance records under the configured state root. Hosted/Railway mode is required to use durable database state and is not allowed to silently fall back to local filesystem persistence.

### External model/reviewer providers

When V3 invokes a reasoning or review provider, it sends the configured system message and prompt to that provider. Depending on the workflow, prompts can contain mission context, requirements, repository/source excerpts, candidate changes, verification evidence and review context.

The current reasoning adapters can call:

- OpenRouter;
- NVIDIA's hosted inference API;
- OpenAI's API.

Provider use is governed separately from deterministic engineering acceptance. Model output is not treated as deterministic execution evidence.

Free-first routing does not change the data-flow boundary: a free hosted model is still an external provider.

As of the 1 October 2026 review check, all models marked free in the live V3 reviewer catalogue were OpenRouter-backed. This is an operational observation, not a permanent product guarantee.

### GitHub and other explicit external integrations

When a GitHub operation is invoked, V3 uses the GitHub API and sends the repository/request information needed for that operation under the configured GitHub credential.

Other external integrations must be documented under the same rule: data is sent only when the corresponding capability is deliberately invoked, and the integration's own data handling remains an external boundary.

## Secrets and sensitive material

Current source-backed controls include:

- configured filesystem secret-path restrictions;
- hashed opaque bearer/token material for supported auth flows;
- hashed node credentials;
- AES-256-GCM encrypted provider credentials;
- API responses that omit provider secret envelopes and node credential hashes;
- fixed/sanitized public error responses on hardened node/operator boundaries;
- council/review packet checks intended to reject known credential-shaped material before provider dispatch.

These controls reduce exposure risk but do not prove that arbitrary repository content is non-sensitive. Operators and customers must still treat source, command output, test logs and review context as potentially confidential.

## Retention: current implementation truth

**V3 does not currently implement a complete customer-data retention schedule.** It now includes a bounded cleanup primitive for expired/consumed/revoked ephemeral credential artifacts, but durable mission/evidence/audit/usage retention durations remain policy-open.

The source defines expiry or revocation semantics for several credentials and temporary authorization objects, but expiry/revocation is not the same as physical deletion of the historical database row.

Examples:

- sessions, invitations, password-reset tokens, OAuth authorization/access tokens and node enrollments have expiry/consumption/revocation state; expired/consumed/revoked rows can now be removed by the tenant-scoped `RetentionLifecycle.cleanupEphemeralCredentials()` primitive;
- provider credentials can be disabled, but disabling is not physical deletion;
- mission, evidence, handoff, audit, usage, council and execution history is durable;
- the current source does not provide an accepted global policy such as “delete mission evidence after N days”;
- no launch claim should state a retention duration that is not implemented and verified.

Backups create an additional retention boundary. The current production database recovery configuration is separately tracked in the recovery plan; backup retention must be defined together with live-data retention.

## Customer deletion and account lifecycle

The schema contains database relationships and cascades for some workspace/user-owned tables, but the current implementation does **not** establish a complete, externally accepted customer deletion workflow covering every durable record, backup copy, local node artifact and external provider boundary.

Therefore V3 must not claim complete erasure-on-request until that lifecycle has been implemented, rehearsed and evidenced.

## Logging and observability

Operational telemetry includes worker identity/session state, deployment revision, database latency, queue counts, recovery-required state, lease pressure and node lifecycle summaries. The operator API is workspace/role protected.

Operational logging and evidence can still contain engineering metadata. Secret values must not intentionally be logged, but launch readiness requires a dedicated redaction/log-retention review rather than assuming every possible tool output is non-sensitive.

## Required customer-facing disclosures before beta

Before external beta, the published product documentation/privacy material must clearly state:

1. what executes locally versus in the hosted control plane;
2. what mission/execution/evidence metadata is stored centrally;
3. that selected source/context can be transmitted to a model provider when hosted reasoning/review is requested;
4. which providers/integrations are enabled for the customer's workspace;
5. how provider credentials are protected;
6. the approved live-data retention periods by record category;
7. the backup/PITR retention and restore window;
8. the implemented account/workspace deletion procedure and backup-expiry behavior;
9. what audit/usage records, if any, must be retained for security/billing reasons;
10. how customers can disable/revoke model, OAuth and node credentials.

## Policy decisions still required

The following are deliberately unresolved rather than invented in source:

- mission/work/evidence/handoff retention duration;
- audit-event retention duration;
- execution-usage/billing retention duration;
- expired auth-token row cleanup cadence;
- disabled provider-credential deletion cadence;
- node/enrollment historical retention;
- operational log/performance-event retention;
- Railway backup schedule and retention after migration to a recovery-capable database;
- customer deletion SLA and backup tombstone/expiry behavior;
- any provider-specific zero-retention or training opt-out commitments.

These values need product/legal/security decisions and then deterministic implementation plus tests.

## Launch acceptance

The retention/data-flow gate is closed only when:

- the policy values above are explicitly approved;
- cleanup/deletion jobs or equivalent lifecycle controls are implemented;
- destructive cleanup is tenant-scoped and auditable;
- deletion is rehearsed against a disposable/restored database;
- backup behavior is consistent with the customer-facing policy;
- provider/integration disclosures match actual runtime configuration;
- the customer-facing document is reviewed against current source and deployment.

Until then, this document is an accurate implementation-derived map and gap statement, not a promise of retention periods that V3 does not yet enforce.
