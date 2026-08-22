# Windows Installation and Multi-PC Guide

## Purpose

Use this package on any Windows development PC that should be reachable from ChatGPT
through a private custom MCP endpoint while keeping the working copy local.

Recommended hostname convention under `fs-mcp.com`:

- Main desktop: `fs.fs-mcp.com`
- Laptop: `laptop.fs-mcp.com`
- Office PC: `office.fs-mcp.com`
- Additional PCs: `<short-pc-name>.fs-mcp.com`

Each PC gets its own Cloudflare named tunnel, endpoint secret, configuration and ChatGPT
custom MCP entry. Never reuse the same endpoint secret across PCs.

## Prerequisites

- Windows 10 or Windows 11.
- Node.js 22 or later.
- Git.
- Cloudflare account with `fs-mcp.com` active.
- Internet access from the PC.
- Docker Desktop only if that PC needs Docker operations.

The normal setup does not require inbound firewall or router port forwarding.

## Per-PC configuration

Create `config/local.json` from the example and generate two independent random secrets:
`endpointSecret` for MCP and `actionsSecret` for GPT Actions. Each must be at least 32 characters
and they must not be identical. Never commit `config/local.json`.

Configure only the project roots that ChatGPT is allowed to access. Keep `allowSecrets` false unless
there is a specific reviewed reason to change it. Use `readOnly: true` for roots that never need writes.

## Cloudflare Tunnel

Install `cloudflared`, authenticate the PC once, and create a named tunnel for that machine.
Route the machine hostname, such as `fs.fs-mcp.com`, to `http://127.0.0.1:8765`.
Run the tunnel with the included watchdog or, where administrator elevation is available,
as a Windows service. Do not expose port 8765 directly on the LAN or router.

Keep Cloudflare tunnel credentials under the user's `.cloudflared` directory; do not copy them
into this repository.
## Configure a private GPT Action

1. Confirm `Status.cmd` reports the local server and Cloudflare tunnel healthy.
2. Open the custom GPT editor and choose **Actions → Create new action**.
3. Import `https://<pc-hostname>.fs-mcp.com/openapi.json`.
4. Set Authentication to **API Key**, type **Bearer**.
5. Run `Copy-Actions-Key.cmd`; paste the clipboard value into the authentication key field.
6. Keep the GPT private during testing and do not add the key to instructions or knowledge files.
7. Test the Action in Preview before relying on it for project work.

Actions and Apps cannot be enabled in the same custom GPT. Use a non-Pro model mode that supports Actions.

## Acceptance checks

Run `npm test`, `npm run check`, `Status.cmd`, the MCP public smoke test and the Actions public smoke test.
Then validate from the custom GPT itself: health, roots, safe file read, harmless PowerShell echo,
Git status, controlled file write/edit, and a negative `git push` test.

Do not treat a new PC as accepted until the ChatGPT-originated Action call reaches that PC successfully.
Do not reuse another machine's tunnel credentials, endpoint secret or Actions key.
## Engineering Agent v2 setup

After installing the v2 source package, run `node scripts/build-skill-registry.mjs` once if you have changed the bundled skill directories. The distribution already includes a generated registry.

In the private FS Remote Development GPT, replace/update the GPT instructions using `agent/FS-REMOTE-DEVELOPMENT-INSTRUCTIONS.md`, then re-import `https://<pc-hostname>.fs-mcp.com/openapi.json` so the GPT sees the discovery and skill Actions.

Acceptance should additionally prove:

1. `capabilities` reports PowerShell command, long-running process, Git and skill support;
2. `agentBootstrap` returns the engineering governance rules;
3. `listSkills` can find a non-engineering skill (for example research/design) and an engineering skill;
4. `readSkill` returns the selected skill entrypoint;
5. `listSkillResources` and `readSkillResource` expose supporting files only within that registered skill;
6. a traversal attempt such as `../other-skill/SKILL.md` is rejected;
7. the existing `runCommand`, `startProcess`, Git and file actions still work;
8. `git push` remains blocked.
