# FS Remote Engineering Agent

FS Remote Engineering Agent combines the existing FS Remote execution engine with an on-demand AI Engineering OS/ECC skills library. The execution engine remains responsible for local filesystem, PowerShell, process and Git operations; skills describe how the agent should approach professional tasks.

## What FS Remote can actually do

The service is not filesystem-only. The shared MCP and GPT Actions operations include:

- list configured roots and directories;
- read, write and exact-edit UTF-8 files;
- run governed PowerShell commands and capture stdout/stderr/exit code;
- start, poll and stop long-running PowerShell process trees;
- Git status, diff, stage and local commit;
- capability discovery;
- engineering-agent bootstrap rules;
- skill search, skill entrypoint reads, and governed supporting-resource reads.

`git push` is intentionally unavailable and generic commands containing `git push` are blocked.

## Session bootstrap

For substantial work, the Custom GPT should:

1. call `agentBootstrap`;
2. call `capabilities`;
3. identify the project/repository and inspect branch, HEAD, dirty state and governing documentation;
4. search `listSkills` using the task domain;
5. load the best matches with `readSkill`;
6. when a skill references bundled support files, use `listSkillResources` and `readSkillResource` instead of arbitrary filesystem discovery;
7. plan and execute using the loaded methodology plus FS Remote tools.

This prevents a new GPT chat from guessing that it has only filesystem access and lets the operating model recover even when chat memory is unavailable.

## Bundled skill estate

The supplied v2 snapshot contains 323 registered skill entrypoints:

- 284 under `agent/skills/core`, sourced from AI Engineering OS `skills/`;
- 39 under `agent/skills/agent`, sourced from AI Engineering OS `.agents/skills/`.

The library deliberately spans more than coding: engineering, architecture, testing, security, agent/MCP work, UI/UX and design direction, research, product, business, content, data, DevOps and other professional workflows. Do not narrow skill selection to software engineering when the task calls for another domain.

Skill IDs are namespaced (`core:<name>` and `agent:<name>`) so duplicate names remain available. Use `listSkills` rather than guessing IDs. `listSkillResources` recursively lists regular supporting files within that registered skill (excluding `SKILL.md`), and `readSkillResource` reads one text resource up to 256 KiB. Traversal outside the skill directory and symlink escapes are rejected.

## Skill refresh

To refresh a development copy after updating the bundled skill directories:

```powershell
node scripts/build-skill-registry.mjs
```

The registry generator reads each top-level `SKILL.md`, extracts the name/description and rewrites `agent/skills/registry.json`.

## Custom GPT instructions

`agent/FS-REMOTE-DEVELOPMENT-INSTRUCTIONS.md` is the ready-to-paste operating prompt for the private FS Remote Development GPT. Do not put MCP secrets, Actions bearer keys, Cloudflare credentials or project `.env` values in those instructions.

## Tool-dependent skills

Some AI Engineering OS/ECC skills reference external MCPs, browser tools or platform-specific clients. Treat their tool references as requirements, not as proof that the tool exists. Use `capabilities` and the current ChatGPT/tool environment to determine what is actually available, then apply the parts of the skill that are valid in that environment.
