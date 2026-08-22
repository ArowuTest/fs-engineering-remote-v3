# FS Remote Engineering Agent v2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Add capability discovery, full AI Engineering OS/ECC skill access including governed supporting resources, and a deterministic engineering-agent bootstrap to FS Remote without breaking its existing MCP/GPT Actions interfaces.

**Architecture:** Keep the existing shared `RemoteOperations` execution engine and add a `SkillCatalog` backed by a generated, bundled registry. Expose additive read-only skill/agent operations through both MCP and GPT Actions, then ship a Custom GPT instruction pack that consumes those operations.

**Tech Stack:** TypeScript, Node.js, Fastify, Model Context Protocol SDK, Zod, OpenAPI 3.1, PowerShell on the target Windows host.

**Spec:** `docs/superpowers/specs/2026-08-22-fs-remote-engineering-agent-v2-design.md`

## Global Constraints

- Preserve all existing API and MCP tool names and behaviours.
- No `git_push` tool or endpoint.
- Existing path, secret, command and root policies remain enforced.
- New runtime operations are read-only.
- Bundle both root `skills/` and `.agents/skills/` from the supplied AI Engineering OS snapshot with its MIT license.
- Do not package machine-specific secrets, logs, runtime files or tunnel credentials.
- TDD: failing test before each production behaviour.

---

### Task 1: Skill Registry and Catalog

**Files:**
- Create: `src/skills.ts`
- Create: `tests/skills.test.ts`
- Create: `scripts/build-skill-registry.mjs`
- Create: `agent/skills/registry.json`
- Create: `agent/skills/LICENSE-AI-ENGINEERING-OS`
- Vendor: `agent/skills/core/**`
- Vendor: `agent/skills/agent/**`

**Interfaces:**
- Produces: `SkillCatalog`, `SkillSummary`, `SkillDetail`, `SkillResourceSummary`, `SkillResourceDetail`.
- `SkillCatalog.list(query?: string, source?: 'core'|'agent', limit?: number): SkillSummary[]`
- `SkillCatalog.read(id: string): Promise<SkillDetail>`
- `SkillCatalog.listResources(id: string): Promise<SkillResourceSummary[]>`
- `SkillCatalog.readResource(id: string, path: string): Promise<SkillResourceDetail>`

- [x] Write registry/catalog tests for full-source counts, namespaced duplicate IDs, search and unknown-ID rejection.
- [x] Run tests and verify RED.
- [x] Vendor the two supplied skill trees and MIT license.
- [x] Implement the registry generator and generate `registry.json`.
- [x] Implement `SkillCatalog` with path-safe registry-backed reads.
- [x] Add RED→GREEN resource tests for recursive listing, governed reads, traversal, entrypoint aliasing, symlink escape and resource-size limits.
- [x] Implement governed supporting-resource listing/reading with a 256 KiB read ceiling.
- [x] Run targeted tests and verify GREEN.

### Task 2: Capability and Bootstrap Operations

**Files:**
- Modify: `src/operations.ts`
- Create/Modify: `tests/operations.test.ts`
- Create: `agent/FS-REMOTE-DEVELOPMENT-INSTRUCTIONS.md`
- Create: `agent/OPERATING-MODEL.md`

**Interfaces:**
- Produces: `ops.capabilities()`, `ops.agentBootstrap()`, `ops.listSkills()`, `ops.readSkill()`, `ops.listSkillResources()`, `ops.readSkillResource()`.

- [x] Write failing operations tests that assert command/process/Git capability advertisement, push policy, skill counts and bootstrap governance.
- [x] Run targeted tests and verify RED.
- [x] Implement operations using `SkillCatalog`; do not alter existing operations.
- [x] Add the agent operating model and ready-to-paste Custom GPT instructions.
- [x] Run targeted tests and verify GREEN.

### Task 3: MCP Exposure

**Files:**
- Modify: `src/server.ts`
- Modify: `tests/server.integration.test.ts`

**Interfaces:**
- Produces MCP tools: `capabilities`, `agent_bootstrap`, `list_skills`, `read_skill`, `list_skill_resources`, `read_skill_resource`.

- [x] Write failing MCP listing/call tests for the discovery/skill tools, including supporting-resource list/read.
- [x] Verify RED.
- [x] Register the read-only MCP tools with bounded schemas.
- [x] Verify GREEN.

### Task 4: GPT Actions and OpenAPI Exposure

**Files:**
- Modify: `src/actions.ts`
- Modify: `src/openapi.ts`
- Modify: `tests/actions.integration.test.ts`

**Interfaces:**
- Produces Actions: `capabilities`, `agentBootstrap`, `listSkills`, `readSkill`, `listSkillResources`, `readSkillResource`.

- [x] Write failing authenticated Actions tests and OpenAPI operation-ID tests.
- [x] Verify RED.
- [x] Add authenticated routes, Zod validation and OpenAPI schemas.
- [x] Verify GREEN and confirm schema contains no secret values.

### Task 5: Documentation and Distribution

**Files:**
- Modify: `README.md`
- Modify: `docs/WINDOWS-SETUP.md`
- Create: `docs/FS-REMOTE-ENGINEERING-AGENT.md`
- Create: `scripts/Package-Distribution.ps1`

**Interfaces:**
- Produces a clean source distribution that excludes local secrets and transient state.

- [x] Document the existing execution capabilities explicitly, including PowerShell, processes and Git.
- [x] Document skill discovery and Custom GPT bootstrap flow.
- [x] Add deterministic packaging script with exclusions for `.git`, `node_modules`, `config/local.json`, `config/tunnel.local.json`, `logs`, `runtime` and `.env`.
- [x] Verify generated archive contents contain no machine-local config files.

### Task 6: Full Gate

- [x] Run `tsc -p tsconfig.json --noEmit` with a compatible compiler.
- [x] Compile to a temporary JS tree and run all platform-neutral tests.
- [x] Run `git diff --check`.
- [x] Review diff against every requirement in the design spec.
- [x] Package the development ZIP.
- [ ] On Windows, run `npm test` and `npm run check` before promotion.
- [ ] Import the generated OpenAPI URL into the FS Remote Development GPT and confirm no schema errors.
- [ ] Acceptance-test `capabilities`, `agentBootstrap`, skill search/read, `runCommand`, `startProcess`, and Git status/diff.