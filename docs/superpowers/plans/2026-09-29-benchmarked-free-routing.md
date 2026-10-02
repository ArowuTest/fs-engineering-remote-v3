# Benchmarked free routing implementation plan — V2B and V3

Goal: honour explicit authorized preferences; otherwise select current task-benchmarked free models, fail over safely and preserve genuine review acceptance.
Architecture: one shared ranking algorithm per checkout, used by routing and replacement. Typed transport failure metadata and scoped cooldowns separate model failure from provider outage. Preserve separate V2B/V3 runtimes and APIs.
Tech: existing TypeScript, node:test, pg (V3 integration), no dependency changes.
Spec: user instructions 2026-09-29; V3 .agent/council-routing-audit-20260929.md.

Constraints: preserve prior V3 candidate; only isolated worktrees; no service restart, production DB write, push or deployment; no paid calls without explicit consent; no policy/authentication evasion; no fabricated benchmarks.

- [ ] Baseline existing routing and provider tests in both trees; freeze source hashes.
- [ ] Permanent RED: task ranking, stale/future/malformed benchmarks, all paid-consent paths, exact provider selection, qualified-only fallback, refusal handling, HTTP-200 errors, model-vs-provider circuits and Retry-After.
- [ ] Implement benchmark-ranking.ts and use it from model-routing-policy.ts, model-fallback.ts and reviewer-broker.ts. Preserve exported APIs and explicit user overrides; automatic candidates need >=0.4 task-weight coverage from valid 0..1 ratings within 90 days. Record evidence and coverage.
- [ ] Implement reasoning-errors.ts; preserve status/type/scope and Retry-After without carrying credentials or prompt excerpts. Update reasoning.ts and gateway: explicit model availability permits another model, generic authorization or safety refusals stop; account/global rate limits are not evaded; model limits do not suppress siblings. Bound requests and propagate cancellation.
- [ ] Fix readiness misattribution if a gateway fallback answered for another model. Exercise actual gateway/council with scripted providers; no test fixture counts as real review.
- [ ] Run targeted/full gates per checkout, then real free-model source council with bounded sealed packets and verified provenance. Adjudicate/retest material findings. Do not claim approval from completion alone.
- [ ] Save per-tree checkpoints, source hashes, review outcome and delivery boundary. Commit only independently accepted work; deployment remains separate.

Review focus: unbenchmarked preference versus automatic fallback; overlapping provider/model identifiers; security denial disguised as availability; provider-wide versus model-wide rate limits; timed-out outer review leaving an orphan request.
