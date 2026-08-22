# FS Remote Engineering Agent v2 Design

## Objective

Evolve FS Remote from a remote execution bridge into the user's primary local AI engineering workspace without disrupting the current working Windows deployment. The stable backend remains compatible with existing GPT Actions and MCP clients, while v2 adds explicit capability discovery, a bundled skill estate sourced from AI Engineering OS/ECC, and a reusable agent bootstrap/operating model.

## Current State Confirmed from Source

FS Remote already exposes more than filesystem access. Both the MCP server and GPT Actions adapter share the same operations service, which supports health, roots, directory listing, file read/write/edit, foreground PowerShell commands, long-running process start/read/stop, and local Git status/diff/stage/commit. `git push` is intentionally blocked.

The immediate gap is therefore discoverability and agent behaviour, not basic execution capability. A custom GPT can incorrectly conclude that it is filesystem-only if its instructions or session context do not force capability discovery.

## Design Principles

1. Preserve the current stable deployment and API compatibility.
2. Make capabilities self-describing so the agent never guesses what it can do.
3. Bundle the full AI Engineering OS skill estate rather than creating a narrow engineering-only subset.
4. Load skills on demand; do not inject hundreds of skill documents into every prompt.
5. Keep skills as methodology/knowledge and FS Remote tools as execution capabilities.
6. Do not weaken existing command, path, secret, or Git-push protections.
7. Keep every new operation read-only unless it genuinely needs mutation.

## New Runtime Capabilities

### `capabilities`

A read-only operation exposed through both MCP and GPT Actions. It returns:

- service version and platform;
- filesystem, command, process, Git, skills and policy capabilities;
- explicit statements that PowerShell execution and long-running processes are supported;
- explicit `git push` prohibition;
- skill registry counts and source categories.

This is the first operation the FS Remote Development GPT should call when entering a new session or when uncertain about available tools.

### `list_skills`

A read-only operation that searches the bundled skills registry by optional text query and source. It returns concise metadata only: skill ID, name, description, source and entrypoint. Results are bounded by a limit.

### `read_skill`

A read-only operation that returns the `SKILL.md` entrypoint for one registered skill. It validates the requested skill ID against the generated registry rather than accepting arbitrary paths.

### `list_skill_resources`

A read-only operation that recursively lists regular supporting files inside one registered skill directory, excluding the `SKILL.md` entrypoint. It returns relative path and size metadata only, skips symlinks, and bounds the result set.

### `read_skill_resource`

A read-only operation that reads one supporting text resource inside a registered skill directory. The caller supplies a registered skill ID plus a relative resource path; traversal outside that skill, entrypoint aliasing, symlink escape and files larger than 256 KiB are rejected.

### `agent_bootstrap`

A read-only operation returning the FS Remote Engineering Agent operating model: role, workflow, capability-discovery rule, skill-loading rule, Git policy, verification rule, and safety boundaries. This provides a deterministic way for the custom GPT to recover its operating context.

## Skills Estate

The v2 package vendors the full relevant skill libraries from the supplied AI Engineering OS/ECC repository:

- `skills/` — primary reusable capability library (284 top-level skill packages in the supplied snapshot);
- `.agents/skills/` — agent-oriented skill variants (39 top-level packages in the supplied snapshot).

The original MIT license is preserved with the vendored skill estate.

A generated `agent/skills/registry.json` indexes every skill entrypoint. IDs are namespaced to avoid collisions:

- `core:<skill-name>` for root `skills/`;
- `agent:<skill-name>` for `.agents/skills/`.

If both sources contain the same skill name, both remain available. The agent may prefer `core:` as the general source and use `agent:` when its execution-specific variant is useful.

## Agent Operating Model

The package includes a ready-to-paste Custom GPT instruction document. Its core rules are:

1. Call `agentBootstrap` and `capabilities` at the start of substantial work or whenever tool availability is uncertain.
2. Never say “filesystem only” or “cannot run commands” without first checking `capabilities`.
3. For substantive work, search `listSkills` and load the most relevant skills with `readSkill` before planning or implementation. When a skill references bundled support files, use `listSkillResources` / `readSkillResource` rather than arbitrary filesystem discovery.
4. Inspect repository, branch, HEAD and dirty state before modifying code.
5. Preserve existing work; no reset/clean/rebase/amend/destructive repository operations without explicit approval.
6. Use TDD for feature/bug/refactor work and verify RED before production implementation.
7. Run fresh tests/typechecks/builds before completion claims.
8. Only create local commits for accepted work; never push unless an explicitly separate future capability is approved.
9. Use existing implementation/reference assets before rebuilding functionality from scratch.
10. Keep execution continuous in coherent engineering chunks rather than stopping after every small edit.

## API Compatibility

All existing endpoints and MCP tools remain unchanged. The six new read-only skill/agent tools/actions are additive:

- `capabilities`
- `agent_bootstrap` / `agentBootstrap`
- `list_skills` / `listSkills`
- `read_skill` / `readSkill`
- `list_skill_resources` / `listSkillResources`
- `read_skill_resource` / `readSkillResource`

Existing authentication remains unchanged: MCP endpoint secret and GPT Actions bearer secret stay separate.

## Testing Strategy

TDD coverage will include:

- registry loading and duplicate-name namespacing;
- bounded text search across names/descriptions;
- skill lookup rejects unknown IDs and path traversal attempts;
- governed resource listing/reading stays inside the registered skill, rejects entrypoint aliasing and symlink escapes, and enforces a 256 KiB read ceiling;
- capabilities accurately advertises existing command/process/Git functions and policy restrictions;
- agent bootstrap contains mandatory governance rules;
- MCP tool listing includes the new read-only tools;
- Actions endpoints require authentication and expose matching data;
- OpenAPI remains GPT-Actions-compatible and contains no configured secrets;
- existing filesystem, command and Git behaviours remain unchanged.

Because the uploaded dependency tree was installed on Windows, workspace verification on Linux compiles with the platform's global TypeScript compiler and runs all platform-neutral compiled tests. PowerShell-specific execution tests must be rerun on the target Windows machine before promotion.

## Packaging and Promotion

The working Windows installation at `C:\Users\sanus\Documents\FS-Remote-MCP` remains untouched during development. v2 is built from the supplied ZIP on branch `feature/fs-remote-engineering-agent-v2` and packaged as a separate ZIP. Machine-specific `config/local.json`, tunnel credentials, runtime files and logs are excluded from the distributable.

Promotion happens only after:

1. workspace platform-neutral tests pass;
2. Windows full test suite passes against the development package;
3. GPT Actions schema imports without validation errors;
4. live acceptance proves `capabilities`, skill discovery, PowerShell, Git, and long-running processes;
5. the existing stable install remains available for rollback.
