---
name: mobile-product-design
description: Use when designing a new mobile app, mobile-first feature, or substantial phone/tablet workflow before implementation.
metadata:
  category: Mobile
  provenance: Full Studio original
---
# Mobile Product Design
## Core principle
Design around mobility, interruption, one-handed use, constrained attention, and platform expectations.
## Workflow
1. Identify the core mobile moment: where the user is, what they need, and how much attention/network they can afford.
2. Prioritize the smallest set of primary actions and define navigation around task frequency.
3. Design onboarding, permissions, keyboard, camera/media, offline, background, and interrupted-session behavior explicitly.
4. Specify responsive phone/tablet layouts, safe areas, reachability, touch targets, dynamic type, and accessibility.
5. Prototype the critical flow on a real-device-sized canvas and test with realistic text/data.

## Quality gates
- Primary tasks are reachable without desktop assumptions.
- Permissions are requested in context with a fallback.
- The app remains understandable after interruption/resume.

## Avoid
- Porting desktop navigation directly to mobile.
- Requiring always-on connectivity without product justification.
- Using tiny dense controls to preserve desktop information density.

## Expected output
Mobile UX specification covering flows, navigation, states, platform behavior, and accessibility.
