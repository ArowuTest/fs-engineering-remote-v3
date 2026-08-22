# FS Remote Engineering Agent v2 — Development Build

- Baseline source: uploaded FS Remote snapshot at commit `eaa291b1aeeac4b896c035700124ff79c86ff728`
- Development branch: `feature/fs-remote-engineering-agent-v2`
- Skill source: uploaded AI Engineering OS/ECC snapshot
- Bundled skill entrypoints: 323 (284 core + 39 agent)
- Bundled supporting skill resources: 225
- Governed resource access: `list_skill_resources` / `read_skill_resource` and GPT Actions equivalents

## Workspace verification

The uploaded `node_modules` tree is Windows-specific, so the Linux workspace cannot execute PowerShell-dependent tests or the Windows-native TypeScript/esbuild package binaries directly.

Verified in the workspace using the platform's TypeScript compiler plus compiled JavaScript tests:

- TypeScript compile/typecheck: PASS
- Platform-neutral config/security/operations/skills/MCP tests: 32/32 PASS
- Platform-neutral GPT Actions/OpenAPI tests: 7/7 PASS
- `git diff --check`: PASS

## Required Windows promotion gate

Before replacing the stable installation, run from the development package on Windows:

1. `npm test`
2. `npm run check`
3. `Status.cmd`
4. Re-import the public `openapi.json` in the private FS Remote Development GPT.
5. Acceptance-test `capabilities`, `agentBootstrap`, `listSkills`, `readSkill`, `listSkillResources`, `readSkillResource`, traversal rejection, PowerShell command execution, long-running process handling, Git status/diff, and the negative `git push` policy.
