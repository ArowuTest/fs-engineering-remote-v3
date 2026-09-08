import { McpServer } from '@modelcontextprotocol/server';
import * as z from 'zod/v4';
import { type AppConfig } from './config.js';
import { createRemoteOperations, type RemoteOperations } from './operations.js';
import { ProcessManager } from './processes.js';
import { SERVICE_NAME, SERVICE_VERSION } from './version.js';

function text(value: unknown) {
  return {
    content: [{
      type: 'text' as const,
      text: typeof value === 'string' ? value : JSON.stringify(value, null, 2),
    }],
  };
}

export function createRemoteServer(
  config: AppConfig,
  processes: ProcessManager,
  operations?: RemoteOperations,
): McpServer {
  const ops = operations ?? createRemoteOperations(config, processes);
  const server = new McpServer({ name: SERVICE_NAME, version: SERVICE_VERSION });

  server.registerTool('health', {
    title: 'FS Remote health',
    description: 'Check whether the local FS Remote MCP service is alive.',
    annotations: { readOnlyHint: true, openWorldHint: false },
  }, async () => text(await ops.health()));
  server.registerTool('list_roots', {
    title: 'List configured roots',
    description: 'List the local filesystem roots this MCP is allowed to access.',
    annotations: { readOnlyHint: true, openWorldHint: false },
  }, async () => text(await ops.listRoots()));

  server.registerTool('capabilities', {
    title: 'FS Remote capabilities',
    description: 'Discover the execution, Git, process, skill and policy capabilities actually available in this FS Remote session.',
    annotations: { readOnlyHint: true, openWorldHint: false },
  }, async () => text(await ops.capabilities()));

  server.registerTool('operator_status',{title:'Operator status and quality gate',description:'Return a versioned harness-neutral status payload covering mission, queue, execution providers, checks, risks and stop-loss blockers.',inputSchema:z.object({missionId:z.string().optional(),checks:z.array(z.object({kind:z.string(),status:z.string()})).default([]),risks:z.array(z.object({code:z.string(),severity:z.enum(['low','medium','high','critical']),summary:z.string(),blocking:z.boolean()})).default([])}),annotations:{readOnlyHint:true,openWorldHint:false}},async(input)=>text(await ops.operatorStatusSnapshot(input)));
  server.registerTool('sandbox_capabilities',{title:'Sandbox execution capabilities',description:'Describe the optional OpenSandbox execution provider. Local execution remains the default.',annotations:{readOnlyHint:true,openWorldHint:false}},async()=>text(await ops.sandboxCapabilities()));
  server.registerTool('sandbox_health',{title:'Sandbox provider health',description:'Probe the optional OpenSandbox provider without affecting local or hosted execution.',annotations:{readOnlyHint:true,openWorldHint:true}},async()=>text(await ops.sandboxHealth()));
  server.registerTool('diagnose_runtime', {
    title: 'Diagnose FS Remote runtime',
    description: 'Diagnose the local server, port/health endpoint, Cloudflare connector, external endpoint, OpenAPI and Actions authentication chain.',
    annotations: { readOnlyHint: true, openWorldHint: true },
  }, async () => text(await ops.diagnoseRuntime()));

  server.registerTool('agent_bootstrap', {
    title: 'Engineering agent bootstrap',
    description: 'Load the FS Remote Engineering Agent operating rules for capability discovery, skills, TDD, Git and verification.',
    annotations: { readOnlyHint: true, openWorldHint: false },
  }, async () => text(await ops.agentBootstrap()));

  server.registerTool('list_skills', {
    title: 'Search bundled skills',
    description: 'Search the bundled AI Engineering OS/ECC skill registry before substantial professional work.',
    inputSchema: z.object({
      query: z.string().default(''),
      source: z.enum(['core', 'agent']).optional(),
      limit: z.number().int().min(1).max(200).default(50),
    }),
    annotations: { readOnlyHint: true, openWorldHint: false },
  }, async ({ query, source, limit }) => text(await ops.listSkills(query, source, limit)));

  server.registerTool('read_skill', {
    title: 'Read bundled skill',
    description: 'Read one registered SKILL.md entrypoint by namespaced skill id.',
    inputSchema: z.object({ id: z.string().min(1) }),
    annotations: { readOnlyHint: true, openWorldHint: false },
  }, async ({ id }) => text(await ops.readSkill(id)));

  server.registerTool('list_skill_resources', {
    title: 'List bundled skill resources',
    description: 'List governed supporting files bundled inside one registered skill directory.',
    inputSchema: z.object({ id: z.string().min(1) }),
    annotations: { readOnlyHint: true, openWorldHint: false },
  }, async ({ id }) => text(await ops.listSkillResources(id)));

  server.registerTool('read_skill_resource', {
    title: 'Read bundled skill resource',
    description: 'Read one governed supporting text file inside a registered skill directory.',
    inputSchema: z.object({ id: z.string().min(1), path: z.string().min(1) }),
    annotations: { readOnlyHint: true, openWorldHint: false },
  }, async ({ id, path }) => text(await ops.readSkillResource(id, path)));

  server.registerTool('list_directory', {
    title: 'List directory',
    description: 'List files and folders within a configured root.',
    inputSchema: z.object({ root: z.string(), path: z.string().default('.') }),
    annotations: { readOnlyHint: true, openWorldHint: false },
  }, async ({ root, path }) => text(await ops.listDirectory(root, path)));

  server.registerTool('read_file', {
    title: 'Read text file',
    description: 'Read UTF-8 text from a file inside a configured root. Secret files are blocked by default.',
    inputSchema: z.object({
      root: z.string(),
      path: z.string(),
      offset: z.number().int().min(0).default(0),
      length: z.number().int().min(1).max(1000).default(250),
    }),
    annotations: { readOnlyHint: true, openWorldHint: false },
  }, async ({ root, path, offset, length }) =>
    text(await ops.readFile(root, path, offset, length)));
  server.registerTool('write_file', {
    title: 'Write text file',
    description: 'Write or append UTF-8 text within a configured writable root.',
    inputSchema: z.object({
      root: z.string(),
      path: z.string(),
      content: z.string(),
      mode: z.enum(['rewrite', 'append']).default('rewrite'),
    }),
    annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false },
  }, async ({ root, path, content, mode }) =>
    text(await ops.writeFile(root, path, content, mode)));

  server.registerTool('edit_file', {
    title: 'Edit text file',
    description: 'Replace exact text inside a UTF-8 file within a writable root.',
    inputSchema: z.object({
      root: z.string(),
      path: z.string(),
      oldText: z.string().min(1),
      newText: z.string(),
      replaceAll: z.boolean().default(false),
    }),
    annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false },
  }, async ({ root, path, oldText, newText, replaceAll }) =>
    text(await ops.editFile(root, path, oldText, newText, replaceAll)));
  server.registerTool('run_command', {
    title: 'Run local command',
    description: 'Run a PowerShell command in a configured root and wait for completion. Normal engineering and deployment commands are allowed; dangerous system commands remain blocked.',
    inputSchema: z.object({
      root: z.string(),
      cwd: z.string().default('.'),
      command: z.string().min(1),
      timeoutMs: z.number().int().min(100).optional(),
    }),
    annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: true },
  }, async ({ root, cwd, command, timeoutMs }) =>
    text(await ops.runCommand(root, cwd, command, timeoutMs)));

  server.registerTool('start_process', {
    title: 'Start local process',
    description: 'Start a long-running PowerShell command in a configured root and return a process ID for later polling.',
    inputSchema: z.object({
      root: z.string(),
      cwd: z.string().default('.'),
      command: z.string().min(1),
    }),
    annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: true },
  }, async ({ root, cwd, command }) =>
    text(await ops.startProcess(root, cwd, command)));
  server.registerTool('read_process_output', {
    title: 'Read process output',
    description: 'Read output added by a previously started long-running process.',
    inputSchema: z.object({
      processId: z.number().int().positive(),
      cursor: z.number().int().min(0).default(0),
    }),
    annotations: { readOnlyHint: true, openWorldHint: false },
  }, async ({ processId, cursor }) =>
    text(await ops.readProcessOutput(processId, cursor)));

  server.registerTool('stop_process', {
    title: 'Stop process',
    description: 'Terminate a process tree started by this MCP service.',
    inputSchema: z.object({ processId: z.number().int().positive() }),
    annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false },
  }, async ({ processId }) => text(await ops.stopProcess(processId)));

  server.registerTool('git_status', {
    title: 'Git status',
    description: 'Show local git status for a configured root. This never pushes.',
    inputSchema: z.object({ root: z.string(), cwd: z.string().default('.') }),
    annotations: { readOnlyHint: true, openWorldHint: false },
  }, async ({ root, cwd }) => text(await ops.gitStatus(root, cwd)));
  server.registerTool('git_diff', {
    title: 'Git diff',
    description: 'Show local unstaged or staged git diff. This never pushes.',
    inputSchema: z.object({
      root: z.string(),
      cwd: z.string().default('.'),
      staged: z.boolean().default(false),
    }),
    annotations: { readOnlyHint: true, openWorldHint: false },
  }, async ({ root, cwd, staged }) => text(await ops.gitDiff(root, cwd, staged)));

  server.registerTool('git_stage', {
    title: 'Stage git changes',
    description: 'Stage selected local paths, or all changes, without committing or pushing.',
    inputSchema: z.object({
      root: z.string(),
      cwd: z.string().default('.'),
      paths: z.array(z.string()).default([]),
      all: z.boolean().default(false),
    }),
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
  }, async ({ root, cwd, paths, all }) =>
    text(await ops.gitStage(root, cwd, paths, all)));
  server.registerTool('git_commit', {
    title: 'Create local git commit',
    description: 'Create a local commit from already staged changes. This MCP deliberately exposes no git push tool.',
    inputSchema: z.object({
      root: z.string(),
      cwd: z.string().default('.'),
      message: z.string().min(1).max(500),
    }),
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
  }, async ({ root, cwd, message }) => text(await ops.gitCommit(root, cwd, message)));
  server.registerTool('git_push', {
    title: 'Push Git branch', description: 'Push a branch to a configured Git remote. Force-with-lease must be explicitly requested.',
    inputSchema: z.object({ root: z.string(), cwd: z.string().default('.'), remote: z.string().default('origin'), branch: z.string().optional(), setUpstream: z.boolean().default(false), forceWithLease: z.boolean().default(false) }),
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
  }, async ({ root, cwd, remote, branch, setUpstream, forceWithLease }) => text(await ops.gitPush(root, cwd, remote, branch, setUpstream, forceWithLease)));
  server.registerTool('inspect_repository', {
    title: 'Inspect repository', description: 'Return branch, HEAD, dirty state, remotes, recent commits and detected project tooling.',
    inputSchema: z.object({ root: z.string(), cwd: z.string().default('.') }), annotations: { readOnlyHint: true, openWorldHint: false },
  }, async ({ root, cwd }) => text(await ops.inspectRepository(root, cwd)));
  server.registerTool('read_agent_memory', {
    title: 'Read agent memory', description: 'Read a persistent .agent memory file for a project.',
    inputSchema: z.object({ root: z.string(), cwd: z.string().default('.'), name: z.string() }), annotations: { readOnlyHint: true, openWorldHint: false },
  }, async ({ root, cwd, name }) => text(await ops.readAgentMemory(root, cwd, name)));
  server.registerTool('write_agent_memory', {
    title: 'Write agent memory', description: 'Write durable project/task memory under the project .agent directory.',
    inputSchema: z.object({ root: z.string(), cwd: z.string().default('.'), name: z.string(), content: z.string() }), annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
  }, async ({ root, cwd, name, content }) => text(await ops.writeAgentMemory(root, cwd, name, content)));
  server.registerTool('append_agent_event', {
    title: 'Append agent event', description: 'Append a timestamped structured event to .agent/events.jsonl.',
    inputSchema: z.object({ root: z.string(), cwd: z.string().default('.'), event: z.record(z.string(), z.unknown()) }), annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
  }, async ({ root, cwd, event }) => text(await ops.appendAgentEvent(root, cwd, event)));
  server.registerTool('save_checkpoint', {
    title: 'Save engineering checkpoint', description: 'Persist task state with current Git branch and HEAD for later resumption.',
    inputSchema: z.object({ root: z.string(), cwd: z.string().default('.'), checkpoint: z.record(z.string(), z.unknown()) }), annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
  }, async ({ root, cwd, checkpoint }) => text(await ops.saveCheckpoint(root, cwd, checkpoint)));
  server.registerTool('load_checkpoint', {
    title: 'Load engineering checkpoint', description: 'Load the durable checkpoint and reconcile it with current repository branch/HEAD.',
    inputSchema: z.object({ root: z.string(), cwd: z.string().default('.') }), annotations: { readOnlyHint: true, openWorldHint: false },
  }, async ({ root, cwd }) => text(await ops.loadCheckpoint(root, cwd)));
  server.registerTool('patch_file', {
    title:'Patch file with hash precondition', description:'Atomically replace exact text only if the file SHA-256 still matches the caller-observed hash. Prevents overwriting concurrent user/agent changes.',
    inputSchema:z.object({root:z.string(),path:z.string(),expectedSha256:z.string().regex(/^[A-Fa-f0-9]{64}$/),oldText:z.string().min(1),newText:z.string(),replaceAll:z.boolean().default(false)}), annotations:{readOnlyHint:false,destructiveHint:false,openWorldHint:false},
  },async({root,path,expectedSha256,oldText,newText,replaceAll})=>text(await ops.patchFile(root,path,expectedSha256,oldText,newText,replaceAll)));

  server.registerTool('exec_list', {
    title: 'List durable execution sessions', description: 'List current and persisted execution sessions, including sessions interrupted by an FS Remote restart.',
    inputSchema: z.object({}), annotations: { readOnlyHint: true, openWorldHint: false },
  }, async () => text(await ops.listExecutionSessions()));
  server.registerTool('exec_poll', {
    title: 'Poll durable execution session', description: 'Read persisted stdout/stderr records from a stable execution session ID using a monotonic record cursor.',
    inputSchema: z.object({ sessionId:z.string().min(1), cursor:z.number().int().min(0).default(0), maxRecords:z.number().int().min(1).max(1000).default(200) }), annotations: { readOnlyHint: true, openWorldHint: false },
  }, async ({sessionId,cursor,maxRecords}) => text(await ops.readExecutionSession(sessionId,cursor,maxRecords)));
  server.registerTool('exec_write', {
    title:'Write to execution session', description:'Write bounded stdin to a currently live execution session. Does not revive interrupted sessions.',
    inputSchema:z.object({sessionId:z.string().min(1),input:z.string().max(65536),appendNewline:z.boolean().default(false)}), annotations:{readOnlyHint:false,destructiveHint:false,openWorldHint:false},
  },async({sessionId,input,appendNewline})=>text(await ops.writeExecutionSession(sessionId,input,appendNewline)));
  server.registerTool('exec_cancel', {
    title:'Cancel execution session', description:'Cancel a currently live execution session by its stable session ID.',
    inputSchema:z.object({sessionId:z.string().min(1)}), annotations:{readOnlyHint:false,destructiveHint:true,openWorldHint:false},
  },async({sessionId})=>text(await ops.cancelExecutionSession(sessionId)));
  server.registerTool('git_worktree_list',{title:'List Git worktrees',description:'List registered Git worktrees with path, HEAD and branch.',inputSchema:z.object({root:z.string(),cwd:z.string().default('.')}),annotations:{readOnlyHint:true,openWorldHint:false}},async({root,cwd})=>text(await ops.listWorktrees(root,cwd)));
  server.registerTool('git_worktree_create',{title:'Create isolated Git worktree',description:'Create a new child worktree and new branch from a verified base revision. Never reuses an existing branch or target path.',inputSchema:z.object({root:z.string(),cwd:z.string().default('.'),path:z.string().min(1),branch:z.string().min(1),base:z.string().default('HEAD')}),annotations:{readOnlyHint:false,destructiveHint:false,openWorldHint:false}},async({root,cwd,path,branch,base})=>text(await ops.createWorktree(root,cwd,path,branch,base)));
  server.registerTool('git_worktree_remove',{title:'Remove clean Git worktree',description:'Remove a registered worktree only when it is clean. Does not delete its branch.',inputSchema:z.object({root:z.string(),cwd:z.string().default('.'),path:z.string().min(1)}),annotations:{readOnlyHint:false,destructiveHint:true,openWorldHint:false}},async({root,cwd,path})=>text(await ops.removeWorktree(root,cwd,path)));
  server.registerTool('search_repository',{title:'Search repository text',description:'Case-insensitive bounded text search across governed Git tracked/untracked text files without returning the whole repository.',inputSchema:z.object({root:z.string(),cwd:z.string().default('.'),query:z.string().min(1),limit:z.number().int().min(1).max(500).default(100)}),annotations:{readOnlyHint:true,openWorldHint:false}},async({root,cwd,query,limit})=>text(await ops.searchRepository(root,cwd,query,limit)));
  server.registerTool('repository_map',{title:'Map repository files',description:'Return a bounded Git-aware repository file map and top-level areas.',inputSchema:z.object({root:z.string(),cwd:z.string().default('.'),limit:z.number().int().min(1).max(5000).default(1000)}),annotations:{readOnlyHint:true,openWorldHint:false}},async({root,cwd,limit})=>text(await ops.repositoryMap(root,cwd,limit)));
  server.registerTool('changed_since',{title:'List files changed since revision',description:'Return structured Git name-status changes since a verified revision.',inputSchema:z.object({root:z.string(),cwd:z.string().default('.'),revision:z.string().min(1)}),annotations:{readOnlyHint:true,openWorldHint:false}},async({root,cwd,revision})=>text(await ops.changedSince(root,cwd,revision)));
  server.registerTool('applicable_instructions',{title:'Resolve repository instructions',description:'Return hierarchical AGENTS.md and .agent/instructions.md files applicable to a repository path, ordered from broadest to most specific.',inputSchema:z.object({root:z.string(),cwd:z.string().default('.'),path:z.string().default('.')}),annotations:{readOnlyHint:true,openWorldHint:false}},async({root,cwd,path})=>text(await ops.applicableInstructions(root,cwd,path)));
  server.registerTool('run_deployment',{title:'Run governed deployment',description:'Run an explicit deployment command with automatic pre-deployment, failure, and verified-success recovery checkpoints. Optional healthCommand must pass before deployment is reported successful.',inputSchema:z.object({root:z.string(),cwd:z.string().default('.'),command:z.string().min(1),healthCommand:z.string().optional(),timeoutMs:z.number().int().min(1000).max(900000).optional()}),annotations:{readOnlyHint:false,destructiveHint:true,openWorldHint:true}},async({root,cwd,command,healthCommand,timeoutMs})=>text(await ops.runDeployment(root,cwd,command,healthCommand,timeoutMs)));
  server.registerTool('run_engineering_check',{title:'Run structured engineering check',description:'Run a governed test/build/check/lint/typecheck and return normalized status, timing, exit code and bounded stdout/stderr tails. Uses repository package scripts when command is omitted.',inputSchema:z.object({root:z.string(),cwd:z.string().default('.'),kind:z.enum(['test','build','check','lint','typecheck']),command:z.string().optional(),timeoutMs:z.number().int().min(1000).max(900000).optional()}),annotations:{readOnlyHint:false,destructiveHint:false,openWorldHint:false}},async({root,cwd,kind,command,timeoutMs})=>text(await ops.runEngineeringCheck(root,cwd,kind,command,timeoutMs)));
  server.registerTool('docker_project_status',{title:'Project Docker status',description:'Inspect only the project Compose stack and return structured service state without changing containers.',inputSchema:z.object({root:z.string(),cwd:z.string().default('.')}),annotations:{readOnlyHint:true,openWorldHint:false}},async({root,cwd})=>text(await ops.dockerProjectStatus(root,cwd)));
  server.registerTool('docker_project_logs',{title:'Project Docker logs',description:'Read bounded logs from the project Compose stack or one validated service.',inputSchema:z.object({root:z.string(),cwd:z.string().default('.'),service:z.string().optional(),tail:z.number().int().min(1).max(2000).default(200)}),annotations:{readOnlyHint:true,openWorldHint:false}},async({root,cwd,service,tail})=>text(await ops.dockerProjectLogs(root,cwd,service,tail)));
  server.registerTool('evidence_bundle',{title:'Freeze engineering evidence bundle',description:'Capture a versioned repository evidence bundle with HEAD/status/diffs, changed-file hashes, optional fresh structured checks, project Docker state, tool versions and checkpoint/project context. Optional checks may execute repository scripts; otherwise the operation is observational.',inputSchema:z.object({root:z.string(),cwd:z.string().default('.'),checks:z.array(z.enum(['test','build','check','lint','typecheck'])).max(5).default([])}),annotations:{readOnlyHint:false,destructiveHint:false,openWorldHint:false}},async({root,cwd,checks})=>text(await ops.evidenceBundle(root,cwd,checks)));
  server.registerTool('save_project_context', {title:'Save portable project context',description:'Persist client-neutral project objective, methodology provenance, constraints, decisions, evidence summary, blockers and next actions for cross-model continuation.',inputSchema:z.object({root:z.string(),cwd:z.string().default('.'),context:z.record(z.string(),z.unknown())}),annotations:{readOnlyHint:false,destructiveHint:false,openWorldHint:false}},async({root,cwd,context})=>text(await ops.saveProjectContext(root,cwd,context)));
  server.registerTool('load_project_context', {title:'Load portable project context',description:'Load durable cross-client project context and reconcile it with live Git branch/HEAD.',inputSchema:z.object({root:z.string(),cwd:z.string().default('.')}),annotations:{readOnlyHint:true,openWorldHint:false}},async({root,cwd})=>text(await ops.loadProjectContext(root,cwd)));
  server.registerTool('resume_project', {title:'Resume project across clients',description:'Return live repository truth plus portable project context and checkpoint for deterministic continuation by any V2B client.',inputSchema:z.object({root:z.string(),cwd:z.string().default('.')}),annotations:{readOnlyHint:true,openWorldHint:false}},async({root,cwd})=>text(await ops.resumeProject(root,cwd)));
  server.registerTool('environment_capabilities', {
    title: 'Environment capabilities', description: 'Discover installed engineering CLIs and browsers without changing the machine.',
    inputSchema: z.object({}), annotations: { readOnlyHint: true, openWorldHint: false },
  }, async () => text(await ops.environmentCapabilities()));
  server.registerTool('project_readiness', {
    title: 'Project readiness', description: 'Produce deterministic repository/tooling readiness and recommended verification checks.',
    inputSchema: z.object({ root: z.string(), cwd: z.string().default('.') }), annotations: { readOnlyHint: true, openWorldHint: false },
  }, async ({ root, cwd }) => text(await ops.projectReadiness(root, cwd)));
  server.registerTool('engineering_evidence', {
    title: 'Engineering evidence', description: 'Collect repository, checkpoint and recent event evidence for progress/acceptance reporting.',
    inputSchema: z.object({ root: z.string(), cwd: z.string().default('.') }), annotations: { readOnlyHint: true, openWorldHint: false },
  }, async ({ root, cwd }) => text(await ops.engineeringEvidence(root, cwd)));
  server.registerTool('browser_start',{title:'Start browser',description:'Start a governed Chrome/Edge Playwright session.',inputSchema:z.object({headless:z.boolean().default(true),executablePath:z.string().optional()}),annotations:{readOnlyHint:false,openWorldHint:true}},async({headless,executablePath})=>text(await ops.browserStart(headless,executablePath)));
  server.registerTool('browser_navigate',{title:'Navigate browser',description:'Navigate a browser session to an HTTP/HTTPS URL.',inputSchema:z.object({sessionId:z.number().int().positive(),url:z.string().url(),waitUntil:z.enum(['load','domcontentloaded','networkidle']).default('domcontentloaded')}),annotations:{readOnlyHint:false,openWorldHint:true}},async({sessionId,url,waitUntil})=>text(await ops.browserNavigate(sessionId,url,waitUntil)));
  server.registerTool('browser_snapshot',{title:'Browser snapshot',description:'Read current page URL, title, visible body text and body HTML.',inputSchema:z.object({sessionId:z.number().int().positive()}),annotations:{readOnlyHint:true,openWorldHint:true}},async({sessionId})=>text(await ops.browserSnapshot(sessionId)));
  server.registerTool('browser_click',{title:'Browser click',description:'Click an element using a Playwright locator selector.',inputSchema:z.object({sessionId:z.number().int().positive(),selector:z.string().min(1)}),annotations:{readOnlyHint:false,openWorldHint:true}},async({sessionId,selector})=>text(await ops.browserClick(sessionId,selector)));
  server.registerTool('browser_type',{title:'Browser type',description:'Fill an element and optionally press Enter.',inputSchema:z.object({sessionId:z.number().int().positive(),selector:z.string().min(1),value:z.string(),pressEnter:z.boolean().default(false)}),annotations:{readOnlyHint:false,openWorldHint:true}},async({sessionId,selector,value,pressEnter})=>text(await ops.browserType(sessionId,selector,value,pressEnter)));
  server.registerTool('browser_wait',{title:'Browser wait',description:'Wait for a selector or a bounded duration.',inputSchema:z.object({sessionId:z.number().int().positive(),selector:z.string().optional(),timeoutMs:z.number().int().min(0).max(30000).default(5000)}),annotations:{readOnlyHint:true,openWorldHint:true}},async({sessionId,selector,timeoutMs})=>text(await ops.browserWait(sessionId,selector,timeoutMs)));
  server.registerTool('browser_console',{title:'Browser console',description:'Read browser console entries incrementally.',inputSchema:z.object({sessionId:z.number().int().positive(),cursor:z.number().int().min(0).default(0)}),annotations:{readOnlyHint:true,openWorldHint:true}},async({sessionId,cursor})=>text(await ops.browserConsole(sessionId,cursor)));
  server.registerTool('browser_network',{title:'Browser network',description:'Read browser network requests/responses incrementally.',inputSchema:z.object({sessionId:z.number().int().positive(),cursor:z.number().int().min(0).default(0)}),annotations:{readOnlyHint:true,openWorldHint:true}},async({sessionId,cursor})=>text(await ops.browserNetwork(sessionId,cursor)));
  server.registerTool('browser_screenshot',{title:'Browser screenshot',description:'Capture a full-page PNG screenshot as base64.',inputSchema:z.object({sessionId:z.number().int().positive()}),annotations:{readOnlyHint:true,openWorldHint:true}},async({sessionId})=>text(await ops.browserScreenshot(sessionId)));
  server.registerTool('browser_close',{title:'Close browser',description:'Close and remove a governed browser session.',inputSchema:z.object({sessionId:z.number().int().positive()}),annotations:{readOnlyHint:false,openWorldHint:true}},async({sessionId})=>text(await ops.browserClose(sessionId)));

  return server;
}
