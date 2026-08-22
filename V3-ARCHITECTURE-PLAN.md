# FS Engineering Remote v3 — Hosted Evolution Plan

## Boundary
v3 is cloned from the accepted v2 codebase. v2 remains the local fallback and must not be used as the cloud-development working tree. Stable FS Remote remains separate.

## Target topology
1. ChatGPT Custom GPT remains a first-class interactive client.
2. Hosted control plane exposes compact Actions/MCP/API and owns durable missions, evidence, approvals, provider coordination and worker scheduling.
3. Hosted workers perform autonomous reasoning, review councils and cloud-capable work.
4. Windows node connects outbound and performs governed work requiring local repositories/PowerShell/browser/tools.
5. Durable hosted state migrates from JSON prototype storage to PostgreSQL before horizontal/multi-worker production use.

## Required v3 workstreams
- Configuration/secrets hardening and cloud-safe runtime identity.
- PostgreSQL mission/work/evidence/handoff/audit persistence with transactional leases.
- Node registration, authentication, heartbeat, capability advertisement and offline recovery.
- ReasoningProvider abstraction for autonomous model workers.
- Native blind review-council worker based on the OpenWA/Livestream protocol.
- GitHub authenticated control-plane/evidence acceptance.
- Deployment/provider evidence adapters.
- Minimal mission/evidence/approval control dashboard; do not clone ChatGPT UI initially.
- Containerization and health/readiness endpoints.
- Railway staging deployment without Railway-specific domain logic.
- End-to-end unattended acceptance including chat closure and fresh-thread mission resume.

## Promotion rule
Do not disable v2 until v3 has been used successfully for a sustained period and has passed hosted recovery, security, concurrency, mission-resume, council, GitHub/CI and deployment acceptance gates.
