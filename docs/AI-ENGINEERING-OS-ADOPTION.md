# AI Engineering OS patterns adopted into FS Remote V3

Reviewed against the local AI-Engineering-OS source on 2026-09-08.

## Adopt now
1. Worktree/session lifecycle as first-class state: create/resume/pause/review/merge-ready/conflict/stale/close/salvage.
2. Harness-neutral status/HUD payload: active execution target, mission/step, worktree/branch, queue, checks, risk, provider health, stale-tool-surface warning.
3. Stop-loss quality gates: no phase promotion after failed verification; evidence before acceptance.
4. Multi-review with code sovereignty: reviewer/council lanes are read-only/proposal-only; one governed writer applies mutations.
5. Self-improvement lifecycle: observation -> proposal -> verification -> promotion -> rollback. Never self-promote a playbook merely because a model proposed it.
6. Portable memory/handoff: durable human-readable context is source-of-truth; indexes/embeddings are secondary; recalled memory is context, not policy.
7. Adapter compliance matrix: ChatGPT, Claude/Codex/OpenCode-style MCP harnesses, customer node, hosted worker and sandbox are tested against one contract.
8. Risk/evidence ledger: security, destructive-operation risk, verification state, execution provider and recovery evidence are observable.

## Already substantially present in V3
- governed worktrees and repository intelligence;
- durable execution sessions and leases;
- missions/workers/handoffs/council;
- structured checks and evidence bundles;
- execution targets local/sandbox/hosted;
- workspace isolation and provider health.

## Do not copy blindly
- harness-specific Claude command syntax;
- dependencies on ccg-workflow or vendor-specific session stores;
- automatic memory-to-policy promotion;
- unrestricted multi-agent filesystem writers;
- UI/TUI implementation before the status contract is stable.

## V3 implementation order
1. Versioned operator status payload + risk ledger.
2. Mission quality-gate/stop-loss policy and merge-ready state.
3. Adapter compliance fixtures across local/sandbox/hosted and MCP/Actions.
4. Portable memory trust metadata and handoff export/import.
5. Evaluator/playbook promotion ledger with rollback.
6. Commercial observability: quotas, cost/resource accounting, notification events.
