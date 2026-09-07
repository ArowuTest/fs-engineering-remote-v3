# V3 optional sandbox execution provider

Decision recorded 2026-09-07.

V3 should retain Railway as the hosted control plane and customer-local V3 nodes as the default execution/data plane. Do not replace local execution with Railway cloud execution by default.

Plan an optional OpenSandbox execution provider behind an execution-target abstraction such as `local | sandbox | hosted`. OpenSandbox should be used for disposable/untrusted builds, tests, reviews, dependency experiments, and other work where isolation is more valuable than exact customer-machine fidelity.

Requirements before implementation:
- preserve local node execution as the default;
- unify sandbox jobs with V3 job/session IDs, evidence, checkpoints, timeouts and error semantics;
- explicit network/credential policies and resource limits;
- no implicit upload of whole customer repositories to cloud sandboxes;
- capability/health reporting must distinguish supported from currently healthy;
- sandbox failure must degrade only that execution provider, not the V3 node/control plane;
- design from V2C cross-platform runtime and V2B reliability lessons (spawn failures handled, durable logs, restart reconciliation, deterministic result contracts).

Do not add OpenSandbox to V2B's default execution path until V3 provider design and resource/security acceptance tests are complete.
