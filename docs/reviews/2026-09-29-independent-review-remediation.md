# Independent review remediation — V3

Date: 29 September 2026. Base: `65fd28e2f9c8c6e34bbf762f52aabdd7d6d6f578`.
Repair branch: `fix/v3-independent-review-20260929`.

## Acceptance boundary

This is a repair candidate, not an external-customer production-readiness certificate. All source changes are isolated from main. No production configuration, database namespace, deployment, push or V2 runtime changes are part of this tranche.

The original 456-test baseline passed before repair. Permanent regressions reproduced the review defects before implementation. Real PostgreSQL tests use only an explicitly selected disposable local database and a unique per-run schema; they do not discover or use production credentials.

Fresh full-gate results and final source hashes belong in the associated closure evidence record. Do not infer acceptance from this document or from a previously green gate.

## Reproduced findings

| ID | Repair | Evidence path |
|---|---|---|
| R01 | Mission evidence now writes to PostgreSQL; hosted reads do not silently fall back to a local cache. | `review-persistence-regressions.test.ts`; PostgreSQL fresh-manager evidence test. |
| R02 | Mission/work updates preserve object workspace identity, reject explicit mismatches and guard upsert ownership. A follow-up gap in creation of new global-coordinator work is also repaired: one SQL INSERT/SELECT validates mission/step and inherits the mission workspace. | Query-binding tests; service-wide worker/mission PostgreSQL test; three fresh regression tests covering global enqueue, cross-workspace/nonexistent parents and the actual unscoped orchestrator path. |
| R03 | Local and verification dispatch carry workspace identity into the node registry. Mission and step ownership are also checked. | Router negative test; real two-workspace dispatch tests. |
| R04 | Enrollment and credential creation share a transaction. The response supports the nodeSecret/secret compatibility fields; the node accepts the canonical field. | HTTP contract and real child-node enrollment. |
| R05 | Same-origin OAuth form submission is admitted; hostile browser origins are denied. | Origin tests and real OAuth authorization/code exchange. |
| R06 | Compact Actions require token scopes plus current role. Direct roots, process sessions and browser state are bound to the workspace; host credentials are not delegated. | Viewer, downgraded-role, foreign-root and annotation-authority tests. |
| R07 | Operation results are classified from exit/timeout/check outcomes rather than promise resolution. Server evidence uses the same outcome semantics. | Node-loop regressions and actual passing/failing command journey. |
| R08 | Unsafe/unknown worker kinds require inspected recovery after uncertain lease loss or failure; caller metadata cannot grant replay authority. | Local and real PostgreSQL lease recovery tests. |
| R09 | Direct path operations reject below-root symlinks/junctions/reparse escapes, including write ancestors. | Disposable outside-root marker and write-denial test. |
| R10 | Completed reasoning alone cannot complete a mission. Reconciliation waits for node jobs, positive required evidence, execution result and council acceptance. | Zero-evidence regression, terminal-state test and real-node acceptance/resume journey. |
| R11 | Planner and worker share the canonical context shape; the worker re-reads live mission state before dispatch. | Unchanged/stale context tests and shared helper. |

## Additional source concerns

| ID | Treatment in this candidate |
|---|---|
| S01 | Node registration is create-only; an existing ID cannot transfer ownership or replace credentials. Existing-node rotation remains a separately authorized lifecycle operation. |
| S02 | Node and supervisor renewal require an unexpired lease. Real PostgreSQL tests cover expiry before recovery. |
| S03 | `__verification` never converts an arbitrary command into a replay-safe operation. |
| S04 | Worker ownership transitions use conditional SQL including current token, owner, expiry, workspace and instance. An interleaved new-lease test rejects stale completion. |
| S05 | Node and worker evidence/accounting/completion are transactional under the lease. Failure and stale-owner tests prove rollback/no stale evidence. |
| S06 | Handoff storage and reads are workspace-scoped. Public worker views omit lease credentials. |
| S07 | Council results are unwrapped from the executor's common result envelope, preserving compatibility with older stored shapes. |
| S08 | Default engineering-check invocation selects `npm` on non-Windows and `npm.cmd` on Windows; runtime manifests/real-platform acceptance remain separate. |
| S09 | Admin routes protect owner role assignment and owner account administration. Negative PostgreSQL tests exercise invitations and password-reset authority. This is not a full identity-system audit. |
| S10 | Declared node/admin limits and an OAuth-specific request budget are wired into request paths. Node failure-budget behavior is tested. |
| S11 | **Contained, not feature-complete:** optional sandbox execution is policy-disabled until workspace-scoped durable submission/completion/evidence/accounting are accepted. A configured healthy endpoint cannot enable execution. |
| S12 | Node database execution has a governed adapter; unsupported hosted vocabulary is rejected before queueing. Optional hosted execution remains disabled. |
| S13 | The node renewal wait is abortable after completion, so consecutive jobs do not wait for the default 40-second renewal interval. Real-node timing is tested. |
| S14 | Production worker experience capture is connected; cache paths are workspace-separated and outcome records are durably referenced as shadow-only evidence. |
| S15 | **Contained, not feature-complete:** hosted repository-code execution is policy-disabled before Git credentials or repository scripts are used. A reviewed disposable isolation boundary is still required before enabling it. |

## Additional defects exposed by integration

OAuth JSON arrays must be serialized as JSON before binding to PostgreSQL JSONB; passing a JavaScript array directly uses PostgreSQL array encoding. The real OAuth journey reproduced the failure and now covers the fix.

Runtime identity observation used `git status` in parallel with a fixture commit, allowing an optional index refresh to contend on `index.lock`. Read-only observation now uses `--no-optional-locks`; the identity test waits for its initial snapshot before changing the fixture checkout.

Existing source-location tests were updated where envelope/accounting creation moved into the atomic state writer. Behavioral database tests supplement those source assertions; test expectations were not changed to accept failed execution or missing evidence.

## Optional execution release policy

`src/execution-release.ts` deliberately has no configuration-only escape hatch. Hosted coordination/reasoning/review workers still run. What is disabled is optional **repository-code execution** on the hosted worker and sandbox submission lacking an accepted durable adapter. This preserves the local-default product rather than silently shipping unsafe execution.

Re-enablement requires a reviewed implementation, isolated credentials/network/resources, bounded immutable materialization and end-to-end workspace/job/evidence/accounting tests. Do not claim these optional targets are finished merely because their unsafe path has been closed.

## Independent review limitation

The FS V2B New runtime, mutation tools and durable checks work. Its grouped intelligence operation is callable; the earlier `Tool not found` and no-benchmarked-free-model diagnoses were superseded by live calls and corrected catalogue inspection. Native council work completes or fails according to actual provider outcomes. The latest attempts have returned empty/nonstructured output, model-specific rate limits or provider timeouts/unavailability; none supplies independent acceptance of the complete candidate. A successful small connectivity/structured-output probe is not a source review. Required free-only routing and spending-consent boundaries remain intact.

No successful independent council verdict has been obtained. Keep this candidate uncommitted/unmerged until required review is completed; do not convert an unavailable reviewer into approval.

## Remaining production acceptance

Read-only production namespace/state inventory is complete; see `2026-09-29-production-namespace-inventory.md`. Thirty instance-scoped legacy rows remain in `v3-staging`, all workspace-unassigned; fourteen jobs and thirteen evidence records lack matching parent missions. Preserve these records and resolve provenance before any migration; no casual namespace rename or automatic assignment to a customer workspace. After accepted repairs, perform exact-revision deployment with appropriate authorization, live disconnect/lease-recovery drills, operator/worker telemetry, alerts, backup/restore and rollback rehearsals, credential lifecycle checks and actual Linux/macOS node acceptance. The independent PostgreSQL/node journey is not a load test, penetration test or production restore drill.

## Reproduction

- `npm run check`
- `npm test` (for constrained hosts, execute the test files with `--test-concurrency=2`)
- Explicitly set `FS_REVIEW_PG_URL` for a disposable loopback `fs_review`/`fs_v3_review` database, then `npm run test:postgres`.
- Inspect `.agent/checkpoint.json`, portable project context and durable execution-session evidence before resuming work.
