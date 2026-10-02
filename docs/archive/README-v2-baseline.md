# FS Remote

FS Remote gives ChatGPT controlled access to a local development computer while keeping
source code, Docker, Git and project files on that computer. The primary workflow is:
edit locally, test locally, review locally, commit locally, and push only when explicitly approved.

## Architecture

FS Remote exposes two adapters over one shared local execution/security engine:

1. MCP: ChatGPT custom/developer MCP → Cloudflare Tunnel → local MCP endpoint.
2. GPT Actions: private custom GPT → authenticated REST/OpenAPI → Cloudflare Tunnel → local Actions API.

Both terminate at `127.0.0.1:8765` on the target PC and share the same configured roots,
PowerShell process manager, Git helpers and security policies. Cloudflare transports traffic;
the application itself is not deployed to Cloudflare.

## Capabilities

The shared operations support health, configured roots, directory listing, safe file read/write/edit,
foreground commands, long-running process start/read/stop, and Git status/diff/stage/commit.

There is intentionally no `git_push` tool or REST endpoint. Generic commands containing `git push`
are blocked before Git runs.

## Security defaults

- Access is limited to named roots in `config/local.json`.
- Parent-directory traversal outside a root is rejected.
- Common secret and key files are blocked by default.
- Known high-risk Windows administration commands are blocked.
- MCP and GPT Actions use separate secrets.
- `config/local.json`, tunnel credentials, runtime files and logs are Git-ignored.
- The server binds only to loopback; Cloudflare Tunnel makes outbound connections from the PC.

Arbitrary PowerShell is a trusted-owner development capability, not a complete OS sandbox.
## Daily use on this PC

Normally do nothing after Windows sign-in; Startup launches both watchdogs.

- `Status.cmd` — check local server, Cloudflare, OpenAPI and Actions authentication health.
- `Start-All.cmd` — start server and Cloudflare watchdogs manually.
- `Stop-All.cmd` — stop both watchdogs.
- `Copy-MCP-URL.cmd` — copy the private MCP endpoint URL without displaying its secret.
- `Copy-Actions-Key.cmd` — copy the GPT Actions Bearer key without displaying it.
- `Copy-GPT-Instructions.cmd` — copy the Engineering Agent v2 Custom GPT instructions to the clipboard.

Never paste either secret into source files, tickets, documentation, knowledge files or chat messages.

## GPT Actions setup

Keep the GPT private while validating it. In the GPT editor, create an Action and import:

`https://fs.fs-mcp.com/openapi.json`

Set Authentication to **API Key → Bearer**. Run `Copy-Actions-Key.cmd` and paste the clipboard
value into the Action authentication field. Do not put that key into the OpenAPI schema or GPT instructions.

A custom GPT can use Actions or Apps, not both simultaneously. Actions are unavailable in Pro mode;
choose a non-Pro GPT-5.6 mode that supports Actions.

After configuration, validate health, roots, a safe read, a harmless PowerShell echo, Git status,
and confirm a `git push` attempt is refused.

## Reuse on another PC

Follow `docs/WINDOWS-SETUP.md`. Give every computer a unique Cloudflare hostname and unique pair
of MCP/Actions secrets, for example `fs.fs-mcp.com`, `laptop.fs-mcp.com`, or `office.fs-mcp.com`.
macOS packaging will be added only after the Windows path passes the real ChatGPT acceptance test.
## Engineering Agent v2

The v2 agent layer makes the existing execution capabilities explicit and adds on-demand AI Engineering OS/ECC skills.

New read-only discovery operations are exposed through both MCP and GPT Actions:

- `capabilities` — authoritative runtime capability/policy manifest;
- `agent_bootstrap` / `agentBootstrap` — engineering-agent operating rules;
- `list_skills` / `listSkills` — bounded search over the bundled skill registry;
- `read_skill` / `readSkill` — load a registered `SKILL.md` entrypoint;
- `list_skill_resources` / `listSkillResources` — list governed support files inside a registered skill;
- `read_skill_resource` / `readSkillResource` — read one governed support file without escaping that skill directory.

The bundled skill estate is under `agent/skills/`. See `docs/FS-REMOTE-ENGINEERING-AGENT.md` and use `agent/FS-REMOTE-DEVELOPMENT-INSTRUCTIONS.md` as the private Custom GPT instruction source.

For substantial work, the GPT should call `agentBootstrap` and `capabilities` before deciding what it can or cannot do, then load task-appropriate skills on demand. This is especially important because FS Remote already supports PowerShell commands, long-running processes and local Git operations; it must not describe itself as filesystem-only without checking the live capability manifest.
