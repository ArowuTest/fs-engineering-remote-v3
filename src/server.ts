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