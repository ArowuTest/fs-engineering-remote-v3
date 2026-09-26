# FS engineering performance benchmark protocol

Performance claims must be correctness-first and must preserve the system, harness, model and task dimensions. Never attribute wall-clock delay to FS merely because it occurred between FS calls.

For each benchmark run record: FS version, harness, model, benchmark ID, wall time, MCP handler time, inter-call/outside time, request/response bytes, tool calls, repeated calls, execution time, verification time, manual interventions, correctness and acceptance.

Run the same repository fixture and acceptance criteria for V2B and V3. Repeat each configuration at least three times after one warm-up run. Long-running build tasks must use durable execution. Low-risk bounded tasks must use the fast engineering depth. Do not compare runs that use different acceptance criteria.

Initial benchmark set: `inspect-context`, `bounded-edit`, `test-failure`, `durable-build`.

Interpretation: high handler ratio implicates FS implementation; high outside ratio implicates harness/model/network/client time; high payload with low handler time implicates information-transfer/context design; high execution ratio implicates the underlying engineering workload. Multiple factors may coexist.
