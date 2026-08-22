---
name: flutter-engineering
description: Use when implementing, reviewing, or debugging Flutter applications, widgets, navigation, state, platform integration, or release builds.
metadata:
  category: Mobile
  provenance: Full Studio original
---
# Flutter Engineering
## Core principle
Keep widget composition predictable, state ownership explicit, and platform channels narrow.
## Workflow
1. Identify Flutter/Dart versions, state-management conventions, routing, generated code, and build flavors.
2. Separate ephemeral widget state from durable application/domain state.
3. Use const/lazy construction and profile rebuild/layout/paint cost before optimizing.
4. Wrap platform channels, permissions, deep links, lifecycle, and storage behind testable interfaces.
5. Run analyzer/tests and representative release builds for target platforms.

## Quality gates
- State lifetimes are clear.
- Platform-specific behavior is isolated.
- Performance work is profile-driven.

## Avoid
- Putting business logic in large build methods.
- Using global mutable state for convenience.
- Judging release performance from debug mode.

## Expected output
Idiomatic Flutter implementation and multi-platform verification evidence.
