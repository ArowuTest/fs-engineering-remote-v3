# GPT Actions Adapter Design

## Status
Approved direction: add a GPT Actions/OpenAPI route to the existing FS Remote service while retaining MCP.
The implementation remains local-first and is not pushed to GitHub until Windows end-to-end testing passes.

## Goal
Allow a private custom GPT running GPT-5.6 to operate the FS development PC through an authenticated HTTPS API exposed by the existing Cloudflare Tunnel.

## Existing architecture
- Local service: `127.0.0.1:8765`.
- Public hostname: `https://fs.fs-mcp.com` through a named Cloudflare Tunnel.
- Existing MCP tools provide files, processes, Git, and command execution.
- Project roots, secret-file blocking, command deny rules, and local-only Git policy already exist.
- Developer MCP execution is blocked by the current ChatGPT account/conversation gate, despite successful MCP discovery.

## Considered approaches
1. Upgrade to a plan with full developer MCP execution. Lowest code change, but adds subscription dependency and is not required to test the current Plus account.
2. Add an OpenAPI REST adapter for GPT Actions. Recommended: keeps GPT-5.6 in ChatGPT, reuses the local engine, and is supported by private custom GPTs.
3. Build a separate remote-control service for Actions. Rejected because it duplicates security and execution logic and would drift from MCP.

## Selected architecture
The service will expose two adapters over one shared operations layer:

`GPT-5.6 Custom GPT -> GPT Action -> HTTPS -> Cloudflare Tunnel -> REST adapter -> shared operations -> FS`

`ChatGPT developer MCP -> MCP adapter -> shared operations -> FS`

## Authentication and transport
- Cloudflare remains transport/DNS only; the application continues to run on the PC.
- Actions use a dedicated random API key, separate from the MCP capability secret.
- The GPT Action will send the key as `Authorization: Bearer <secret>`.
- The key is stored only in `config/local.json` and in the private GPT Action authentication setting.
- The key is never embedded in the OpenAPI schema, repository, logs, documentation, or chat.
- Action API routes live under `/actions/v1/*`.
- `/healthz` remains non-sensitive service health; Actions endpoints require authentication.

## Shared operations layer
Business logic will be moved out of the MCP registration callbacks into a reusable operations/service module.
Both adapters call the same functions for:
- roots and directory listing;
- file read/write/edit;
- synchronous and long-running processes;
- Git status/diff/stage/commit;
- local command execution.

This avoids duplicate authorization and policy code. MCP registration becomes a thin translation layer and REST routes become another thin translation layer.

## Actions surface
The initial OpenAPI surface mirrors the capabilities already tested locally, but groups them into a compact API suitable for GPT Actions.
Read operations use GET where practical; state-changing operations use POST.
No endpoint exists for `git push`.

The schema will include stable `operationId` values, request/response shapes, concise descriptions, and the fixed server URL `https://fs.fs-mcp.com`.
A generated OpenAPI JSON/YAML file will be safe to paste into the GPT editor because it contains no secret.

## Security model
- File operations remain confined to configured roots and continue blocking sensitive files unless a root explicitly allows them.
- Writable operations reject read-only roots.
- Arbitrary shell commands are treated as trusted-developer operations, not a filesystem sandbox. A shell command runs with the Windows user's privileges and can potentially reference host paths outside the selected root.
- Existing command policy continues blocking `git push` and known high-risk host-management commands.
- The Actions API will use constant-time API-key comparison and generic 401 responses.
- Request bodies remain size-limited; command output remains bounded; configured timeouts remain enforced.
- API keys and capability secrets are redacted from logs.
- Browser-origin rejection remains on MCP. Actions will not depend on browser-origin requests.

The service is therefore intended for one trusted owner controlling their own development PCs. It is not a multi-tenant remote shell and should not be exposed without the Cloudflare tunnel and strong API key.

## GPT behavior
A private custom GPT named `FS Remote Development` will receive instructions to:
- inspect before modifying;
- work locally first;
- preserve unrelated dirty work;
- run relevant tests/builds before claiming completion;
- show/review diffs before local commits;
- create local commits only when appropriate;
- never attempt a GitHub push unless the user later changes the platform policy outside this service;
- avoid reading or printing secrets.

The GPT uses Actions, not Apps, because OpenAI currently makes those mutually exclusive within one GPT. Actions are unavailable in Pro mode, so the GPT must use a non-Pro GPT-5.6 mode that supports Actions.

## Error handling
REST responses use structured JSON with an HTTP status and a non-secret error message.
Validation failures return 400, authentication failures 401, forbidden policy actions 403, missing resources 404, and unexpected failures 500.
The adapter must not return stack traces, configuration secrets, Cloudflare credentials, or environment variables.

Long-running commands return a process ID and are polled through a separate read operation. Stopping a job is explicit and only applies to processes launched by the service.

## Verification gates
Before configuring the custom GPT, the Windows implementation must pass:
1. unit tests for authentication, route validation, root confinement, secret blocking, and command policy;
2. existing MCP tests, proving the refactor did not regress MCP;
3. TypeScript check and dependency audit;
4. local REST tests on `127.0.0.1:8765` with valid/invalid credentials;
5. public HTTPS smoke tests through `fs.fs-mcp.com`;
6. harmless command execution, process start/poll/stop, file write/edit/read, and Git status/diff;
7. negative proof that `git push` remains blocked;
8. custom GPT Preview test against the Action schema.

## Multi-PC and macOS direction
Machine-specific secrets and Cloudflare credentials remain local and Git-ignored.
The generic codebase will later support separate platform launchers: PowerShell/Windows startup for Windows and shell/launchd for macOS.
The shared TypeScript operations/API layer should remain platform-neutral where possible; shell/process adapters may differ by OS.
Each PC receives a unique hostname and API key, for example `fs.fs-mcp.com` and `mac.fs-mcp.com`.

## Out of scope for this Windows gate
- GitHub push or deployment of the application to Cloudflare.
- Public GPT/GPT Store publication.
- OAuth or multi-user authentication.
- Full shell sandboxing or multi-tenant isolation.
- macOS implementation before Windows Actions succeeds end-to-end.
