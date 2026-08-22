# Safe Upgrade to FS Remote Engineering Agent v2

The current working FS Remote installation should remain the rollback baseline until the v2 Windows gate passes.

## 1. Test the package as a sibling copy

Extract the v2 package beside, not over, the stable installation, for example:

`C:\Users\sanus\Documents\FS-Remote-MCP-v2-test`

Do not copy `.git`, `node_modules`, logs or runtime state from the stable installation.

Copy only the machine-local configuration needed for local tests:

- `config\local.json`
- `config\tunnel.local.json` only when testing the existing tunnel after promotion

Keep those files local and uncommitted.

## 2. Install and gate on Windows

From the sibling copy:

```powershell
npm install
node scripts/build-skill-registry.mjs
npm test
npm run check
```

Do not proceed if any test or typecheck fails.

## 3. Update the private Custom GPT

After the code is promoted and the normal Cloudflare route is healthy:

1. Run `Copy-GPT-Instructions.cmd` and paste the result into the FS Remote Development GPT instructions.
2. Re-import `https://fs.fs-mcp.com/openapi.json` in the GPT Action editor.
3. Keep the existing bearer key; the v2 endpoints use the same Actions authentication model.
4. Save the GPT privately.

## 4. Acceptance

From the saved GPT, prove in order:

1. `capabilities` reports `run_command`, process tools, Git tools and 323 bundled skills.
2. `agentBootstrap` reports the engineering-agent rules.
3. `listSkills` finds `core:deep-research` and `core:frontend-design-direction`.
4. `readSkill` returns each selected skill entrypoint.
5. `listSkillResources` lists support files for `core:agent-self-evaluation`, including `references/evaluation-criteria.md`.
6. `readSkillResource` reads that resource and rejects a `../` traversal attempt.
7. A harmless PowerShell command succeeds.
8. A long-running process can be started and polled.
9. Git status/diff work in a real project repo.
10. `git push` remains rejected.

Only after this acceptance should the stable installation be replaced or renamed as the rollback copy.
