---
name: android-material-design
description: Use when an Android phone, tablet, or foldable interface needs platform-appropriate navigation, adaptive layout, Material behavior, or accessibility.
metadata:
  category: Mobile
  provenance: Inspired by ECC android-clean-architecture coverage; design content is original
---
# Android Material Design
## Core principle
Design for Android’s adaptive surfaces and system behaviors rather than one fixed handset canvas.
## Workflow
1. Identify window-size classes and navigation pattern appropriate to available width.
2. Specify system bar/inset handling, back behavior, keyboard, predictive navigation where relevant, and lifecycle recovery.
3. Use semantic Material components/tokens where they serve the product, with accessible states and touch targets.
4. Design for font scaling, TalkBack, dark theme, reduced motion, and localization expansion.
5. Test representative compact, medium, expanded, and interrupted/backgrounded states.

## Quality gates
- Back navigation is deterministic.
- Layouts adapt instead of merely stretching.
- Lifecycle restoration does not lose critical user work.

## Avoid
- Assuming all Android devices share one size/aspect.
- Ignoring process/lifecycle recreation.
- Rebuilding system components without a strong reason.

## Expected output
Android adaptive UX specification with navigation, lifecycle, and accessibility behavior.
