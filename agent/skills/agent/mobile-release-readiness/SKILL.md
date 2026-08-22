---
name: mobile-release-readiness
description: Use when a mobile app or major mobile update is approaching TestFlight, Play testing, store review, or production rollout.
metadata:
  category: Mobile
  provenance: Full Studio original
---
# Mobile Release Readiness
## Core principle
Release readiness combines app behavior, store requirements, observability, rollback strategy, and real-device evidence.
## Workflow
1. Verify production signing/build variants, environment configuration, permissions, privacy declarations, and deep/universal links.
2. Run smoke/regression flows on representative physical devices, OS versions, network states, and upgrade paths.
3. Check crashes, ANRs/hangs, startup, memory, battery, background behavior, and analytics/consent.
4. Validate store metadata, screenshots, review notes, subscription/payment disclosures, and accessibility claims as applicable.
5. Define staged rollout, monitoring thresholds, rollback/hotfix path, and owner.

## Quality gates
- Release build is tested, not only debug.
- Upgrade from previous production version is exercised.
- Operational monitoring exists before rollout.

## Avoid
- Uploading a build before testing production configuration.
- Assuming store approval equals runtime quality.
- No plan for bad migrations after app update.

## Expected output
Go/no-go checklist with evidence, known risks, rollout, and recovery plan.
