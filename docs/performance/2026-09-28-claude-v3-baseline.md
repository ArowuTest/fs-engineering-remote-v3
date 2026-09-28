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

A long-lived Claude `stream-json` harness was run successfully after the subscription window reset.

### Warm identity turns

One warm-up plus three measured `runtime_identity` turns were executed through the same Claude process. The measured turn times were:

- 3,405.407 ms
- 3,324.828 ms
- 3,200.403 ms

Median measured wall time: **3,324.828 ms**.

The warm-up turn took 15,020.138 ms. The measured turns therefore show that process/session reuse removes most of the cold-start penalty for this trivial tool task, although the warm Claude path is still materially slower than the 334.346 ms direct V3 identity baseline.

### Warm bounded-edit turns

The full bounded-edit benchmark was then repeated through one persistent Claude process, resetting and recommitting the Git fixture before every turn and independently scoring each turn. All three measured turns were accepted and used exactly four tool calls.

| Metric | Cold Claude + V3 | Warm persistent Claude + V3 |
| --- | ---: | ---: |
| Median wall time | 32,046 ms | 18,288 ms |
| Median V3 handler time | 3,646.523 ms | 3,841.507 ms |
| Median outside-V3 time | 28,399.477 ms | 11,647.538 ms |
| Median pre-first-tool time | 17,552.332 ms | 2,328.696 ms |
| Median inter-call time | 8,139.716 ms | 7,793.842 ms |
| Median post-last-tool time | 3,229 ms | 1,698 ms |
| Tool calls | 4 | 4 |
| Accepted measured runs | 3/3 | 3/3 |

Warm process reuse reduced median end-to-end time by about 43% and cut the pre-first-tool component by about 87%. It did **not** materially remove inter-call model reasoning, which remains the largest persistent outside-FS component once startup is amortized.

One measured warm run had an FS-handler outlier: `engineering_context` took 5.705 s and `run_engineering_check` 6.811 s, while the other three warm-profile runs were roughly 0.73–0.84 s and 1.95–1.97 s respectively. The medians above are robust to that single run, but the variance should remain visible and be investigated separately rather than attributed to Claude process reuse.

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
