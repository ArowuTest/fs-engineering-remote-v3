# FS Decision subsystem

FS Decision provides bounded typed decisions without making a learned model authoritative over engineering truth or safety policy.

## Contract

Questions are `choice`, ordinal `score`, or binary-probability `noul`. Choice/score cardinality is capped at 20; large capability sets must use retrieval/shortlisting before a decision question. State is compiled into `fs.decision.state.v1` rather than dumping raw mission/repository text into a model.

## Authority

The deterministic provider is authoritative in v1. It resolves facts/policy it can prove and **abstains** on ambiguity. Tests, evidence freshness, permissions, destructive-operation policy, deployment health, Git truth and acceptance gates remain deterministic.

Learned providers run in shadow mode until an FS evaluation proves competence, calibration and selective risk on project/trajectory-disjoint data. A shadow failure cannot change the authoritative result.

## Laya-derived research principles

The design deliberately adopts useful concepts found during the pinned Laya audit: typed decisions, soft distributions, ordinal semantics, batching-compatible contracts, external competence routing, abstention, and bounded choice sets. It deliberately does not trust upstream confidence, `act_probability`, mutable model downloads, raw state truncation, high-cardinality direct choice, or upstream training/calibration methodology as production policy.

No Laya runtime or checkpoint is currently a V3 dependency.

## Planned shadow provider

A future `laya_shadow` provider must use a vendored/pinned source and model revision with artifact hashes and locked dependencies. It must record latency, distributions and abstention data without controlling execution. Only after held-out FS evaluation and calibration may any low-risk learned decision become eligible for policy authorization.
