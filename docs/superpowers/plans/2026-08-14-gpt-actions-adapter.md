# GPT Actions Adapter Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a secure REST/OpenAPI Actions adapter to FS Remote so a custom GPT can control the same local Windows development operations already exposed through MCP.

**Architecture:** Extract the existing filesystem/Git/process behaviors into a shared `RemoteOperations` service. Keep MCP as one adapter and add a Fastify REST adapter authenticated with a separate Bearer API key, plus a public OpenAPI schema at `/openapi.json` that never contains secrets.

**Tech Stack:** TypeScript, Node.js, Fastify, Zod, MCP SDK, OpenAPI 3.x, Cloudflare Tunnel, Windows PowerShell.

## Global Constraints

- Keep the existing MCP endpoint and behavior working.
- Actions use a distinct secret from `endpointSecret`; no secret appears in Git or OpenAPI.
- The application remains local on `127.0.0.1:8765`; Cloudflare is transport only.
- No `git push` endpoint exists, and generic commands containing `git push` remain blocked.
- File operations remain confined to configured roots and secret-file policy.
- Do not push this repository to GitHub during implementation.
- Windows is the only implementation target in this plan; macOS follows after Windows acceptance.

---### Task 1: Shared operations service

**Files:**
- Create: `src/operations.ts`
- Modify: `src/server.ts`
- Test: `tests/operations.test.ts`

**Interfaces:**
- `createRemoteOperations(config, processes)` returns methods for health, roots, files, processes and Git.
- MCP tool handlers delegate to those methods without changing schemas or tool names.

- [ ] **Step 1: Write failing parity tests**

```ts
const ops = createRemoteOperations(config, manager);
assert.equal((await ops.health()).ok, true);
assert.match((await ops.readFile('test', 'README.md', 0, 20)).content, /fixture/);
await assert.rejects(() => ops.runCommand('test', '.', 'git push origin main'), /disabled by policy/);
```

- [ ] **Step 2: Run the focused tests and confirm failure**

Run: `npx tsx --test tests/operations.test.ts`
Expected: FAIL because `createRemoteOperations` does not exist.

- [ ] **Step 3: Extract the existing logic into `RemoteOperations`**

Move root lookup, file operations, process operations and Git command construction from `src/server.ts` into typed methods. Preserve `resolveInRoot`, `assertReadablePath`, `assertWritablePath`, and `assertCommandAllowed` exactly as the policy boundary.

- [ ] **Step 4: Make MCP delegate to the shared service**

`createRemoteServer(config, processes)` should construct one operations object and keep the current 14 MCP registrations, each returning `text(await ops.<method>(...))`.

- [ ] **Step 5: Run operations + MCP regression tests**

Run: `npm test`
Expected: all existing tests plus `operations.test.ts` PASS.

- [ ] **Step 6: Commit locally**

`git add src/operations.ts src/server.ts tests/operations.test.ts && git commit -m "refactor: share remote operations across adapters"`### Task 2: Actions authentication and configuration

**Files:**
- Modify: `src/config.ts`
- Modify: `config/config.example.json`
- Test: `tests/config.test.ts`

**Interfaces:**
- `AppConfig.actionsSecret: string` is required and at least 32 characters.
- `loadConfig()` continues accepting Windows BOM JSON.

- [ ] **Step 1: Add failing config tests**

```ts
assert.throws(() => validateConfig({ endpointSecret: strong, actionsSecret: 'short' }), /actionsSecret/);
const cfg = validateConfig({ endpointSecret: strong, actionsSecret: otherStrong });
assert.equal(cfg.actionsSecret, otherStrong);
```

- [ ] **Step 2: Run config tests and confirm failure**

Run: `npx tsx --test tests/config.test.ts`
Expected: FAIL because `actionsSecret` is not defined.

- [ ] **Step 3: Add the new secret to config validation**

Extend `RawConfig` and `AppConfig` with `actionsSecret`; require minimum 32 characters and require it to differ from `endpointSecret`.

- [ ] **Step 4: Update example config without adding live credentials**

Add `"actionsSecret": "REPLACE_WITH_A_DIFFERENT_32_PLUS_CHARACTER_SECRET"` to `config/config.example.json` only.

- [ ] **Step 5: Update live `config/local.json` with a random secret locally**

Generate 32 random bytes using `RandomNumberGenerator`/PowerShell cryptographic RNG and write only to the already Git-ignored live config. Never echo the value.

- [ ] **Step 6: Run config tests**

Run: `npx tsx --test tests/config.test.ts`
Expected: PASS.

- [ ] **Step 7: Commit only non-secret files locally**

`git add src/config.ts config/config.example.json tests/config.test.ts && git commit -m "feat: add separate actions authentication secret"`### Task 3: REST Actions adapter and OpenAPI schema

**Files:**
- Create: `src/actions.ts`
- Create: `src/openapi.ts`
- Modify: `src/http.ts`
- Test: `tests/actions.integration.test.ts`

**Interfaces:**
- Protected REST prefix: `/actions/*` with `Authorization: Bearer <actionsSecret>`.
- Public `GET /openapi.json` returns schema only; no secret values.
- HTTP handlers call the same `RemoteOperations` instance used by MCP.

- [ ] **Step 1: Write failing integration tests**

Cover: 401 with no/incorrect Bearer token; 200 for authorized health/list-roots; file read; harmless command; process start/read/stop; Git status; write/edit in a temp fixture; `git push` rejection; OpenAPI schema contains operation IDs and no configured secrets.

- [ ] **Step 2: Run the focused integration test and confirm failure**

Run: `npx tsx --test tests/actions.integration.test.ts`
Expected: FAIL because Actions routes do not exist.

- [ ] **Step 3: Implement `createOpenApiDocument(baseUrl)`**

Return an OpenAPI document describing only the REST Actions operations, with `servers: [{ url: baseUrl }]`, JSON request/response bodies, stable `operationId` values, and a Bearer security scheme. Do not embed the actual key.

- [ ] **Step 4: Implement protected REST routes**

Register routes for health, roots, directory listing, file read/write/edit, command run, process start/read/stop, Git status/diff/stage/commit. Use structured JSON responses and convert operation errors to clear 400 responses; authentication failures are 401.

- [ ] **Step 5: Wire both adapters into one Fastify app**

Construct `ProcessManager` and `RemoteOperations` once in `buildHttpApp`. Pass that operations instance to MCP and Actions so both interfaces share long-running process state.

- [ ] **Step 6: Run Actions integration tests and full regression suite**

Run: `npm test && npm run check`
Expected: PASS with no MCP regression.

- [ ] **Step 7: Commit locally**

`git add src/actions.ts src/openapi.ts src/http.ts tests/actions.integration.test.ts && git commit -m "feat: expose authenticated GPT Actions API"`### Task 4: Operator helpers and public Cloudflare smoke test

**Files:**
- Create: `scripts/Copy-Actions-Key.ps1`
- Create: `Copy-Actions-Key.cmd`
- Create: `scripts/smoke-actions-public.ts`
- Modify: `scripts/Status.ps1`
- Modify: `README.md`
- Modify: `docs/WINDOWS-SETUP.md`

**Interfaces:**
- `Copy-Actions-Key.cmd` copies the live secret to clipboard without printing it.
- Public smoke test takes only the public base URL, loads the live secret locally, and never logs it.

- [ ] **Step 1: Write the clipboard helper**

Read `config/local.json`, validate that `actionsSecret` exists, call `Set-Clipboard`, and print only `Actions API key copied to clipboard.`

- [ ] **Step 2: Extend status checks**

Keep local health and Cloudflare health, then also fetch `/openapi.json` and report whether the Actions schema is reachable. Never display secret-bearing URLs or keys.

- [ ] **Step 3: Add a public Actions smoke script**

The script should call `https://fs.fs-mcp.com/actions/health`, list roots, run `Write-Output 'ACTIONS_PUBLIC_OK'`, and deliberately verify a `git push` command is rejected. Authentication is loaded from local config and attached only as a Bearer header.

- [ ] **Step 4: Document custom GPT setup**

Document: GPT editor → Actions → Create new action → import `https://fs.fs-mcp.com/openapi.json`; Authentication → API Key → Bearer; obtain key by running `Copy-Actions-Key.cmd`; keep GPT private during validation. Note that a GPT may use Actions or Apps, not both, and Actions are unavailable in Pro mode.

- [ ] **Step 5: Restart watchdog-managed server and verify public route**

Run `Stop-All.cmd`, then `Start-All.cmd`, then `Status.cmd` and `npx tsx scripts/smoke-actions-public.ts https://fs.fs-mcp.com`.
Expected: local health healthy, Cloudflare healthy, OpenAPI healthy, Actions command succeeds, `git push` rejected.

- [ ] **Step 6: Commit locally**

`git add scripts/Copy-Actions-Key.ps1 Copy-Actions-Key.cmd scripts/smoke-actions-public.ts scripts/Status.ps1 README.md docs/WINDOWS-SETUP.md && git commit -m "docs: add GPT Actions setup and verification"`### Task 5: Final verification and ChatGPT acceptance

**Files:**
- Modify only if verification exposes a defect.

- [ ] **Step 1: Run repository verification**

Run: `npm test && npm run check && npm audit --audit-level=high`
Expected: all tests pass, TypeScript clean, no high/critical vulnerability.

- [ ] **Step 2: Re-run both public protocols**

Run existing MCP public smoke and the new Actions public smoke against `https://fs.fs-mcp.com`.
Expected: both discover/respond correctly; Actions authentication rejects missing/incorrect keys; `git push` remains blocked.

- [ ] **Step 3: Verify Git hygiene**

Run `git status --short --branch`, `git diff --check`, and search tracked files for live secret values or Cloudflare credentials without printing those values. Confirm `config/local.json`, `.cloudflared` credentials, logs and runtime remain untracked.

- [ ] **Step 4: Configure the private custom GPT**

In ChatGPT, import the public OpenAPI schema and configure Bearer API-key authentication using the clipboard helper. Do not put the key in GPT instructions, schema, knowledge files or conversation text.

- [ ] **Step 5: Run acceptance calls from the custom GPT**

Call health, list roots, read a safe file, execute `Write-Output 'GPT_ACTIONS_OK'`, check Git status, perform one controlled temporary write/edit/delete-by-command only inside the MCP repo if needed, and verify `git push` is refused.

- [ ] **Step 6: Mark Windows accepted only after ChatGPT-originated execution succeeds**

Do not start macOS packaging or GitHub distribution before this acceptance gate passes.

## Plan Self-Review

- Spec coverage: shared operations, separate auth, OpenAPI, REST endpoints, Cloudflare verification, helpers, docs, negative security tests and ChatGPT acceptance are all mapped to tasks.
- Type consistency: `actionsSecret`, `RemoteOperations`, `/actions/*` and `/openapi.json` names are consistent throughout.
- Scope: Windows Actions adapter only; macOS and GitHub distribution remain explicitly outside this plan.