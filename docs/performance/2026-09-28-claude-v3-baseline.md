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

## Windows Git-inspection tail-latency finding

A later direct-control regression showed the accepted bounded-edit median rising from 4,889 ms to 8,208 ms, with handler time rising from 3,598 ms to 6,177 ms. Command-level instrumentation localized intermittent ~5-second stalls to Git command execution during recovery/repository inspection rather than to process spawn itself.

A controlled launch test found that sequential direct Git was normally much cheaper than PowerShell-wrapped Git (about 121 ms vs 365 ms median for `git branch --show-current`), but the decisive result came from repository-inspection strategy testing:

| Strategy | Median inspection wall | Max | Runs >3 s |
| --- | ---: | ---: | ---: |
| Five direct Git commands concurrently | ~227 ms | 10,234 ms | 8/20 |
| Five direct Git commands sequentially | ~587 ms | 626 ms | 0/20 |

The fast concurrent path therefore had unacceptable Windows tail latency despite its lower best-case median. V3 now performs the static repository-inspection Git commands sequentially via direct `git` subprocesses, with the existing shell path retained as fallback.

On an isolated V3 runtime using the same accepted four-call bounded-edit benchmark, the pre-change sequentially accepted baseline was **6,623 ms median**. After the sequential direct-Git change, three measured accepted runs were 3,338 ms, 3,320 ms and 3,415 ms, for a **3,338 ms median**. All three independently passed the fixture tests. This is about a 50% reduction from that immediately preceding isolated baseline while also removing the observed Git concurrency tail in the measured runs.

The checkpoint microbenchmark after the change measured roughly 722 ms median patch work, 1,900 ms engineering-check wall time, 1,308 ms of actual test-command time and about 592 ms of post-check checkpoint overhead.

A second recovery optimization then limited automatic repository recovery snapshots to the repository fields they actually persist (branch, HEAD, dirty/status), and successful non-mutating engineering checks stopped rewriting the recovery checkpoint after already recording durable `ENGINEERING_CHECK` evidence. Failed or timed-out checks still refresh recovery state. The same independently accepted isolated bounded-edit benchmark then measured **2,469 ms median** across 2,561 ms, 2,469 ms and 2,444 ms measured runs, all 3/3 accepted. `run_engineering_check` itself fell to roughly 1.22–1.29 s in those runs.

### Warm Claude after FS runtime optimization

The persistent Claude bounded-edit profile was rerun against the optimized isolated V3 runtime. All three measured turns were accepted and used exactly four task calls.

| Metric | Earlier warm Claude | Optimized warm Claude |
| --- | ---: | ---: |
| Median wall time | 18,288 ms | **10,031 ms** |
| Median V3 handler time | 3,841.507 ms | **2,340.924 ms** |
| Median outside-V3 time | 11,647.538 ms | **7,726.560 ms** |
| Median pre-first-tool | 2,328.696 ms | **1,615.904 ms** |
| Median inter-call | 7,793.842 ms | **5,328.656 ms** |
| Median post-last-tool | 1,698 ms | **739 ms** |
| Tool calls | 4 | 4 |
| Accepted measured runs | 3/3 | 3/3 |

The optimized persistent-harness path is therefore about **45% faster end to end** than the earlier warm profile. The remaining median wall time is still dominated by the harness/model envelope rather than FS: about 2.34 s of V3 handler work versus 7.73 s outside V3. Compared with the optimized direct V3 median of 2.47 s, persistent Claude is about 4x slower end to end while performing the same four accepted operations.

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
