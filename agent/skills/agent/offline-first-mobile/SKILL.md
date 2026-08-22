---
name: offline-first-mobile
description: Use when a mobile app must remain useful with weak, intermittent, expensive, or absent connectivity and later synchronize safely.
metadata:
  category: Mobile
  provenance: Full Studio original
---
# Offline First Mobile
## Core principle
Treat local state and synchronization as a product contract with explicit conflict semantics.
## Workflow
1. Classify data as local-only, cacheable, synchronizable, server-authoritative, or sensitive/nonpersistent.
2. Define local identifiers, mutation queue, retry/backoff, idempotency, ordering, and deletion semantics.
3. Choose conflict strategy per entity: server wins, client wins, merge, version check, or user resolution.
4. Expose sync state and recoverable failures without blocking unrelated offline work.
5. Test airplane mode, network flapping, duplicate delivery, clock skew, stale data, and reinstall/logout boundaries.

## Quality gates
- Queued mutations are replay-safe.
- Conflicts cannot silently corrupt high-value data.
- Sensitive data follows storage/security policy offline.

## Avoid
- Calling a cache offline-first.
- Retrying mutations without idempotency.
- Hiding sync failures indefinitely.

## Expected output
Offline data model, sync protocol, conflict policy, UX states, and failure tests.
