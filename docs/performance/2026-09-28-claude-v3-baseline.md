# Claude Code → FS Remote V3 performance baseline

Date: 2026-09-28

This note records the first accepted, repeated harness benchmark comparing Claude Code with the deterministic V3 control on the same bounded-edit fixture. Warm-up runs are excluded from medians. Failed authentication/rate-limit runs are excluded from performance conclusions.

## Bounded-edit benchmark

Task: change only `src/math.js` so `label()` returns `new-label`, then run `node --test test/math.test.js`.

Both profiles used the same accepted four-call sequence:

1. `engineering_context`
2. `read_file`
3. `patch_file`
4. `run_engineering_check`

All three measured Claude runs and all three measured deterministic-control runs were accepted by the independent benchmark oracle.

| Metric | Deterministic V3 control | Claude Code + V3 |
| --- | ---: | ---: |
| Median wall time | 4,889 ms | 32,046 ms |
| Median V3 handler time | 3,597.738 ms | 3,646.523 ms |
| Median outside-V3 time | 1,295.262 ms | 28,399.477 ms |
| Median pre-first-tool time | 1,134.799 ms | 17,552.332 ms |
| Median inter-call time | 104.766 ms | 8,139.716 ms |
| Median post-last-tool time | 48 ms | 3,229 ms |
| Tool calls | 4 | 4 |
| Accepted measured runs | 3/3 | 3/3 |

Interpretation: for this controlled task, V3 handler time is effectively the same under both profiles. The large end-to-end difference is outside FS and is dominated first by harness/model startup or first inference, then by reasoning between tool calls.

## Claude startup isolation

A second experiment separated plain Claude startup from V3 MCP-schema loading. Stdin was explicitly closed for noninteractive child processes to avoid Claude waiting for input.

| Profile | Median measured wall time |
| --- | ---: |
| Plain Claude, no tools | 9,946.866 ms |
| V3 MCP schema loaded, no tool call | 10,396.488 ms |
| Increment associated with schema-loaded profile | 449.622 ms |

The sample does not support treating V3 schema registration as the primary startup bottleneck. Plain Claude startup/model response time is already approximately ten seconds on this host.

An earlier startup run that left stdin open showed materially higher times and emitted Claude's three-second stdin warning. Those numbers are superseded for startup-isolation purposes by the stdin-closed run above.

## Direct V3 identity baseline

Four local MCP `runtime_identity` requests were run directly through the deterministic MCP client. Excluding the warm-up, the median measured round trip was:

- 334.346 ms
- response size: 431 bytes

This is the appropriate FS-side baseline for future cold-vs-warm Claude identity-call measurements.

## Invalid / blocked measurements

The corrected `v3_identity` startup profile was not completed because Claude hit its subscription session limit. Those failed 429 runs are not valid performance samples and must not contribute to medians.

A `--bare` Claude profile was also rejected because that mode did not inherit the authenticated context on this machine. It is not performance evidence.

## Warm-process experiment

A long-lived Claude `stream-json` benchmark harness has been implemented. A protocol smoke test successfully sent a user turn and received a structured `result` event from the same process. The smoke test encountered the active Claude 429 session limit, so no warm-process performance conclusion is recorded yet.

The next valid experiment is:

- one warm-up identity turn in a persistent Claude process;
- three measured identity turns through the same process;
- compare each turn with the 334.346 ms direct V3 identity baseline;
- if successful, repeat the bounded-edit benchmark using a persistent harness profile and keep it separate from the stateless Claude profile.

## Engineering implications

Current evidence supports these priorities:

1. Keep noninteractive harness stdin closed unless streaming input is intentionally required.
2. Prefer a warm/persistent harness process where the harness supports it and correctness/isolation requirements permit it.
3. Use strict MCP isolation and task-relevant tool whitelists.
4. Supply FS root and relative cwd explicitly to avoid path-discovery retries.
5. Use compact `engineering_context` once and minimize repeated model tool-selection decisions.
6. Do not spend disproportionate effort shaving milliseconds from `read_file`/`patch_file` while tens of seconds are accumulating outside FS.

## Reproduction tooling

Relevant scripts:

- `scripts/benchmark-claude-bounded.mts`
- `scripts/benchmark-direct-bounded-session.mts`
- `scripts/benchmark-claude-startup.mts`
- `scripts/benchmark-claude-warm-stream.mts`
- `scripts/benchmark-envelope-report.mts`
- `scripts/mcp-benchmark-client.mts`

Benchmark session data remains in the local performance store and is not required to trust this note; the figures above are copied from accepted persisted runs and their timing envelopes.
