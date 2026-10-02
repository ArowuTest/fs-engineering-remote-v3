# Production namespace inventory — 29 September 2026

Status: read-only inventory completed; no production migration or state repair performed.

## Observation boundary

The inspection ran through Railway SSH into the existing control-plane service. It used a PostgreSQL REPEATABLE READ / READ ONLY transaction, verified `transaction_read_only=on`, bounded individual statements to eight seconds, and ended with ROLLBACK. No credential values or customer payloads were returned.

Deployment observed: `65fd28e2f9c8c6e34bbf762f52aabdd7d6d6f578`.
Runtime variables remain `FS_REMOTE_INSTANCE_ID=v3-staging` and `FS_REMOTE_ENVIRONMENT=staging`. These identifiers are distinct from Railway's production environment and its deployed identity.

Evidence:
- `exec-mumlcmof-57b1abf3`, completed exit 0, observation 2026-09-29T11:26:40.184Z.
- `exec-mumlgduo-26103725`, completed exit 0, observation 2026-09-29T11:29:34.905Z.
- Local detailed results: `.agent/production-namespace-inventory.json` and `.agent/production-reference-inventory.json`.

## Counts

All nonempty instance-scoped tables observed use `v3-staging`. No `v3-production` rows were found in the ten inspected instance-scoped tables.

| Table | Rows | Null workspace ownership |
|---|---:|---:|
| missions | 1 | 1 |
| work_items | 1 | 1 |
| execution_nodes | 1 | 1 |
| node_jobs | 14 | 14 |
| evidence | 13 | 13 |
| approvals | 0 | 0 |
| audit_events | 0 | 0 |
| council_runs | 0 | 0 |
| handoffs | 0 | 0 |
| mission_supervisor_leases | 0 | No workspace column |

The populated instance-scoped tables contain 30 rows in total. Global account tables contain one user, one workspace and one membership; node_enrollments is empty. This is an inventory of counts, not permission to assign all legacy state to that workspace.

All observed work is terminal: the single mission and worker item are completed; node_jobs contains ten completed and four failed records. The snapshot contained no queued or leased worker/node jobs.

## Referential exceptions

All fourteen node jobs reference mission identifiers absent from the missions table (four distinct references). All thirteen evidence records likewise reference absent mission identifiers (three distinct references). The single work item has a matching mission. No instance or workspace mismatch was found among records that had a matching parent mission.

These observations do not establish how the legacy records were created or whether they are historic smoke-test records. Their provenance must be reconciled before repair. No records were removed, reparented, or labelled as customer state. Sixty-eight primary/unique/foreign-key definitions were recorded for migration analysis.

## Decision and next acceptance boundary

Do not rename the namespace merely to make its label agree with Railway. The next change must preserve node authentication and all existing history.

Before any production write:
1. Capture and rehearse an actual recoverable backup of the application state.
2. Resolve the legacy missing-mission references from original test/run provenance; preserve them as historical evidence unless an explicit disposition is accepted.
3. Decide whether to retain `v3-staging` as an internal stable identifier or migrate it in a maintenance window. A name change is not itself a readiness improvement.
4. Rehearse the proposed migration on a restored disposable database with row-count, parent-reference and credential-continuity checks.
5. Only then apply accepted migration/configuration changes and verify exact revision, node heartbeat, durable history and a fresh mission.

The source repairs and live state have separate acceptance boundaries. An inventory or healthy readiness endpoint is not evidence that unmerged fixes have reached production.
