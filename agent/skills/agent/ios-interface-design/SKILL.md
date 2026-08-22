---
name: ios-interface-design
description: Use when an iPhone or iPad interface must align with iOS interaction patterns, system capabilities, accessibility, and App Store-quality expectations.
metadata:
  category: Mobile
  provenance: Full Studio original
---
# IOS Interface Design
## Core principle
Respect iOS platform conventions unless a deliberate deviation creates measurable user value.
## Workflow
1. Choose native navigation patterns that match hierarchy and modal intent.
2. Account for safe areas, Dynamic Type, VoiceOver, reduced motion, dark appearance, and system text/input behavior.
3. Use system permission flows and explain sensitive access immediately before it is needed.
4. Prefer familiar system controls and gestures; provide discoverable alternatives for custom gestures.
5. Review on compact and regular size classes plus at least one real-device scenario.

## Quality gates
- Text scales without clipping core actions.
- Back/dismiss behavior matches presentation style.
- System privacy and accessibility states are handled.

## Avoid
- Android/web conventions transplanted unchanged.
- Custom controls that imitate system controls poorly.
- Fixed typography that breaks Dynamic Type.

## Expected output
iOS interaction and layout guidance ready for implementation/review.
