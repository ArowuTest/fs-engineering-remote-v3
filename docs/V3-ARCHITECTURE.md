# FS Remote V3 architecture

V3 is a hosted control plane with customer-local execution as the default data plane.

## Execution targets
- `local`: customer node; default; highest environment fidelity.
- `sandbox`: optional OpenSandbox provider; explicit materialisation/security policy required.
- `hosted`: Railway worker; only governed hosted adapters are allowed.

Every executor returns `fs-remote.execution-result.v1`. Missions/plans select a target explicitly; unsupported or unhealthy providers fail closed.

## Engineering harness
V3 exposes durable execution, atomic hash-guarded patching, governed worktrees, repository intelligence/instruction discovery, structured verification, Docker evidence, governed deployment, recovery checkpoints, missions/workers/council, and evidence bundles.

## AI Engineering OS patterns
V3 adopts harness-neutral worktree/session lifecycle, stop-loss quality gates, read-only reviewer lanes/code sovereignty, operator status/risk payloads, portable handoff/memory principles, adapter compliance tests, and verified playbook promotion. See `AI-ENGINEERING-OS-ADOPTION.md`.

## Commercial boundaries
Workspace/tenant identity scopes missions, workers, node jobs and hosted state. Local source does not move to Railway/OpenSandbox unless a governed execution request explicitly materialises it. OpenSandbox defaults to restricted networking/no credentials and bounded resources.
