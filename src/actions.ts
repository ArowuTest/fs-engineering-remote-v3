import { timingSafeEqual } from 'node:crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import * as z from 'zod/v4';
import { type AppConfig } from './config.js';
import { type RemoteOperations, createRemoteOperations } from './operations.js';
import { resolveOAuthAccessToken } from './oauth-http.js';
import type { ProcessManager } from './processes.js';
import { createOpenApiDocument } from './openapi.js';

function firstHeader(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function isAuthorized(header: string | undefined, secret: string): boolean {
  if (!header) return false;
  const supplied = Buffer.from(header, 'utf8');
  const expected = Buffer.from(`Bearer ${secret}`, 'utf8');
  return supplied.length === expected.length && timingSafeEqual(supplied, expected);
}

function publicBaseUrl(request: FastifyRequest): string {
  const forwardedHost = firstHeader(request.headers['x-forwarded-host']);
  const host = forwardedHost ?? request.headers.host ?? '127.0.0.1';
  const forwardedProto = firstHeader(request.headers['x-forwarded-proto']);
  const local = host.startsWith('127.0.0.1') || host.startsWith('localhost');
  const protocol = forwardedProto ?? (local ? 'http' : 'https');
  return `${protocol}://${host}`;
}

async function respond<T>(reply: FastifyReply, fn: () => Promise<T>): Promise<T | FastifyReply> {
  try {
    return await fn();
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Operation failed.';
    return reply.code(400).send({ error: message });
  }
}
const listDirectoryBody = z.object({
  root: z.string(),
  path: z.string().default('.'),
}).strict();
const readFileBody = z.object({
  root: z.string(), path: z.string(),
  offset: z.number().int().min(0).default(0),
  length: z.number().int().min(1).max(1000).default(250),
}).strict();
const writeFileBody = z.object({
  root: z.string(), path: z.string(), content: z.string(),
  mode: z.enum(['rewrite', 'append']).default('rewrite'),
}).strict();
const editFileBody = z.object({
  root: z.string(), path: z.string(), oldText: z.string().min(1), newText: z.string(),
  replaceAll: z.boolean().default(false),
}).strict();
const runCommandBody = z.object({
  root: z.string(), cwd: z.string().default('.'), command: z.string().min(1),
  timeoutMs: z.number().int().min(100).optional(),
}).strict();
const startProcessBody = z.object({
  root: z.string(), cwd: z.string().default('.'), command: z.string().min(1),
}).strict();
const processReadBody = z.object({
  processId: z.number().int().positive(), cursor: z.number().int().min(0).default(0),
}).strict();
const processStopBody = z.object({ processId: z.number().int().positive() }).strict();
const gitStatusBody = z.object({ root: z.string(), cwd: z.string().default('.') }).strict();
const gitDiffBody = z.object({
  root: z.string(), cwd: z.string().default('.'), staged: z.boolean().default(false),
}).strict();
const gitStageBody = z.object({
  root: z.string(), cwd: z.string().default('.'),
  paths: z.array(z.string()).default([]), all: z.boolean().default(false),
}).strict();
const gitCommitBody = z.object({
  root: z.string(), cwd: z.string().default('.'), message: z.string().min(1).max(500),
}).strict();
const gitPushBody = z.object({
  root: z.string(), cwd: z.string().default('.'), remote: z.string().default('origin'), branch: z.string().optional(),
  setUpstream: z.boolean().default(false), forceWithLease: z.boolean().default(false),
}).strict();
const inspectRepositoryBody = z.object({ root: z.string(), cwd: z.string().default('.') }).strict();
const memoryReadBody = z.object({ root: z.string(), cwd: z.string().default('.'), name: z.string() }).strict();
const memoryWriteBody = z.object({ root: z.string(), cwd: z.string().default('.'), name: z.string(), content: z.string() }).strict();
const eventBody = z.object({ root: z.string(), cwd: z.string().default('.'), event: z.record(z.string(), z.unknown()) }).strict();
const checkpointBody = z.object({ root: z.string(), cwd: z.string().default('.'), checkpoint: z.record(z.string(), z.unknown()) }).strict();
const checkpointLoadBody = z.object({ root: z.string(), cwd: z.string().default('.') }).strict();
const repositoryReadBody = z.object({ root: z.string(), cwd: z.string().default('.') }).strict();
const browserStartBody = z.object({ headless: z.boolean().default(true), executablePath: z.string().optional() }).strict();
const browserNavigateBody = z.object({ sessionId: z.number().int().positive(), url: z.string().url(), waitUntil: z.enum(['load','domcontentloaded','networkidle']).default('domcontentloaded') }).strict();
const browserSessionBody = z.object({ sessionId: z.number().int().positive() }).strict();
const browserSelectorBody = z.object({ sessionId: z.number().int().positive(), selector: z.string().min(1) }).strict();
const browserTypeBody = z.object({ sessionId: z.number().int().positive(), selector: z.string().min(1), value: z.string(), pressEnter: z.boolean().default(false) }).strict();
const browserWaitBody = z.object({ sessionId: z.number().int().positive(), selector: z.string().optional(), timeoutMs: z.number().int().min(0).max(30000).default(5000) }).strict();
const browserCursorBody = z.object({ sessionId: z.number().int().positive(), cursor: z.number().int().min(0).default(0) }).strict();
const listSkillsBody = z.object({
  query: z.string().default(''),
  source: z.enum(['core', 'agent']).optional(),
  limit: z.number().int().min(1).max(200).default(50),
}).strict();
const readSkillBody = z.object({ id: z.string().min(1) }).strict();
const listSkillResourcesBody = z.object({ id: z.string().min(1) }).strict();
const readSkillResourceBody = z.object({ id: z.string().min(1), path: z.string().min(1) }).strict();

export function registerActionsRoutes(
  app: FastifyInstance,
  config: AppConfig,
  ops: RemoteOperations,
  processes?: ProcessManager,
): void {
  const requireAuth = async (request: FastifyRequest, reply: FastifyReply) => {
    if (isAuthorized(request.headers.authorization, config.actionsSecret)) { (request as any).fsAuth={mode:'legacy',scopes:['*']}; return; }
    const header=request.headers.authorization??'',token=header.startsWith('Bearer ')?header.slice(7).trim():'';
    let oauth=null;try{oauth=token?await resolveOAuthAccessToken(token):null}catch{oauth=null}
    if(!oauth)return reply.code(401).send({error:'Unauthorized.'});
    (request as any).fsAuth={mode:'oauth',workspaceId:oauth.workspace_id,userId:oauth.user_id,role:oauth.role,scopes:oauth.scopes??[]};
  };
  const requireLegacyAuth = async (request: FastifyRequest, reply: FastifyReply) => { if (!isAuthorized(request.headers.authorization, config.actionsSecret)) return reply.code(401).send({ error: 'Legacy Actions authentication required.' }); (request as any).fsAuth={mode:'legacy',scopes:['*']}; };
  const scopedOps=(request:FastifyRequest)=>{const workspaceId=(request as any).fsAuth?.workspaceId;return workspaceId&&processes?createRemoteOperations(config,processes,workspaceId):ops};
  const scope=(request:FastifyRequest,required:'fs.read'|'fs.write'|'fs.node')=>{const a=(request as any).fsAuth;if(a?.mode==='legacy'||a?.scopes?.includes(required))return;throw new Error(`OAuth scope '${required}' is required.`)};

  app.get('/openapi.json', async (request) => createOpenApiDocument(publicBaseUrl(request)));

  app.get('/actions/health', { preHandler: requireLegacyAuth }, async (_request, reply) =>
    respond(reply, () => ops.health()));
  app.get('/actions/roots', { preHandler: requireLegacyAuth }, async (_request, reply) =>
    respond(reply, () => ops.listRoots()));
  app.get('/actions/capabilities', { preHandler: requireLegacyAuth }, async (_request, reply) =>
    respond(reply, () => ops.capabilities()));
  app.get('/actions/diagnose-runtime', { preHandler: requireLegacyAuth }, async (_request, reply) =>
    respond(reply, () => ops.diagnoseRuntime()));
  app.get('/actions/agent-bootstrap', { preHandler: requireLegacyAuth }, async (_request, reply) =>
    respond(reply, () => ops.agentBootstrap()));
  app.post('/actions/list-skills', { preHandler: requireLegacyAuth }, async (request, reply) =>
    respond(reply, async () => {
      const body = listSkillsBody.parse(request.body);
      return await ops.listSkills(body.query, body.source, body.limit);
    }));
  app.post('/actions/read-skill', { preHandler: requireLegacyAuth }, async (request, reply) =>
    respond(reply, async () => {
      const body = readSkillBody.parse(request.body);
      return await ops.readSkill(body.id);
    }));
  app.post('/actions/list-skill-resources', { preHandler: requireLegacyAuth }, async (request, reply) =>
    respond(reply, async () => {
      const body = listSkillResourcesBody.parse(request.body);
      return await ops.listSkillResources(body.id);
    }));
  app.post('/actions/read-skill-resource', { preHandler: requireLegacyAuth }, async (request, reply) =>
    respond(reply, async () => {
      const body = readSkillResourceBody.parse(request.body);
      return await ops.readSkillResource(body.id, body.path);
    }));
  app.post('/actions/list-directory', { preHandler: requireLegacyAuth }, async (request, reply) =>
    respond(reply, async () => {
      const body = listDirectoryBody.parse(request.body);
      return await ops.listDirectory(body.root, body.path);
    }));
  app.post('/actions/read-file', { preHandler: requireLegacyAuth }, async (request, reply) =>
    respond(reply, async () => {
      const body = readFileBody.parse(request.body);
      return await ops.readFile(body.root, body.path, body.offset, body.length);
    }));
  app.post('/actions/write-file', { preHandler: requireLegacyAuth }, async (request, reply) =>
    respond(reply, async () => {
      const body = writeFileBody.parse(request.body);
      return await ops.writeFile(body.root, body.path, body.content, body.mode);
    }));
  app.post('/actions/edit-file', { preHandler: requireLegacyAuth }, async (request, reply) =>
    respond(reply, async () => {
      const body = editFileBody.parse(request.body);
      return await ops.editFile(body.root, body.path, body.oldText, body.newText, body.replaceAll);
    }));
  app.post('/actions/run-command', { preHandler: requireLegacyAuth }, async (request, reply) =>
    respond(reply, async () => {
      const body = runCommandBody.parse(request.body);
      return await ops.runCommand(body.root, body.cwd, body.command, body.timeoutMs);
    }));
  app.post('/actions/start-process', { preHandler: requireLegacyAuth }, async (request, reply) =>
    respond(reply, async () => {
      const body = startProcessBody.parse(request.body);
      return await ops.startProcess(body.root, body.cwd, body.command);
    }));
  app.post('/actions/read-process-output', { preHandler: requireLegacyAuth }, async (request, reply) =>
    respond(reply, async () => {
      const body = processReadBody.parse(request.body);
      return await ops.readProcessOutput(body.processId, body.cursor);
    }));
  app.post('/actions/stop-process', { preHandler: requireLegacyAuth }, async (request, reply) =>
    respond(reply, async () => {
      const body = processStopBody.parse(request.body);
      return await ops.stopProcess(body.processId);
    }));
  app.post('/actions/git-status', { preHandler: requireLegacyAuth }, async (request, reply) =>
    respond(reply, async () => {
      const body = gitStatusBody.parse(request.body);
      return await ops.gitStatus(body.root, body.cwd);
    }));
  app.post('/actions/git-diff', { preHandler: requireLegacyAuth }, async (request, reply) =>
    respond(reply, async () => {
      const body = gitDiffBody.parse(request.body);
      return await ops.gitDiff(body.root, body.cwd, body.staged);
    }));
  app.post('/actions/git-stage', { preHandler: requireLegacyAuth }, async (request, reply) =>
    respond(reply, async () => {
      const body = gitStageBody.parse(request.body);
      return await ops.gitStage(body.root, body.cwd, body.paths, body.all);
    }));
  app.post('/actions/git-commit', { preHandler: requireLegacyAuth }, async (request, reply) =>
    respond(reply, async () => {
      const body = gitCommitBody.parse(request.body);
      return await ops.gitCommit(body.root, body.cwd, body.message);
    }));
  app.post('/actions/git-push', { preHandler: requireLegacyAuth }, async (request, reply) =>
    respond(reply, async () => {
      const body = gitPushBody.parse(request.body);
      return await ops.gitPush(body.root, body.cwd, body.remote, body.branch, body.setUpstream, body.forceWithLease);
    }));
  app.post('/actions/inspect-repository', { preHandler: requireLegacyAuth }, async (request, reply) =>
    respond(reply, async () => { const body = inspectRepositoryBody.parse(request.body); return await ops.inspectRepository(body.root, body.cwd); }));
  app.post('/actions/read-agent-memory', { preHandler: requireLegacyAuth }, async (request, reply) =>
    respond(reply, async () => { const body = memoryReadBody.parse(request.body); return await ops.readAgentMemory(body.root, body.cwd, body.name); }));
  app.post('/actions/write-agent-memory', { preHandler: requireLegacyAuth }, async (request, reply) =>
    respond(reply, async () => { const body = memoryWriteBody.parse(request.body); return await ops.writeAgentMemory(body.root, body.cwd, body.name, body.content); }));
  app.post('/actions/append-agent-event', { preHandler: requireLegacyAuth }, async (request, reply) =>
    respond(reply, async () => { const body = eventBody.parse(request.body); return await ops.appendAgentEvent(body.root, body.cwd, body.event); }));
  app.post('/actions/save-checkpoint', { preHandler: requireLegacyAuth }, async (request, reply) =>
    respond(reply, async () => { const body = checkpointBody.parse(request.body); return await ops.saveCheckpoint(body.root, body.cwd, body.checkpoint); }));
  app.post('/actions/load-checkpoint', { preHandler: requireLegacyAuth }, async (request, reply) =>
    respond(reply, async () => { const body = checkpointLoadBody.parse(request.body); return await ops.loadCheckpoint(body.root, body.cwd); }));
  app.get('/actions/environment-capabilities', { preHandler: requireLegacyAuth }, async (_request, reply) =>
    respond(reply, async () => await ops.environmentCapabilities()));
  app.post('/actions/project-readiness', { preHandler: requireLegacyAuth }, async (request, reply) =>
    respond(reply, async () => { const body = repositoryReadBody.parse(request.body); return await ops.projectReadiness(body.root, body.cwd); }));
  app.post('/actions/engineering-evidence', { preHandler: requireLegacyAuth }, async (request, reply) =>
    respond(reply, async () => { const body = repositoryReadBody.parse(request.body); return await ops.engineeringEvidence(body.root, body.cwd); }));
  app.post('/actions/browser-start', { preHandler: requireLegacyAuth }, async (request, reply) => respond(reply, async()=>{const b=browserStartBody.parse(request.body);return await ops.browserStart(b.headless,b.executablePath);}));
  app.post('/actions/browser-navigate', { preHandler: requireLegacyAuth }, async (request, reply) => respond(reply, async()=>{const b=browserNavigateBody.parse(request.body);return await ops.browserNavigate(b.sessionId,b.url,b.waitUntil);}));
  app.post('/actions/browser-snapshot', { preHandler: requireLegacyAuth }, async (request, reply) => respond(reply, async()=>{const b=browserSessionBody.parse(request.body);return await ops.browserSnapshot(b.sessionId);}));
  app.post('/actions/browser-click', { preHandler: requireLegacyAuth }, async (request, reply) => respond(reply, async()=>{const b=browserSelectorBody.parse(request.body);return await ops.browserClick(b.sessionId,b.selector);}));
  app.post('/actions/browser-type', { preHandler: requireLegacyAuth }, async (request, reply) => respond(reply, async()=>{const b=browserTypeBody.parse(request.body);return await ops.browserType(b.sessionId,b.selector,b.value,b.pressEnter);}));
  app.post('/actions/browser-wait', { preHandler: requireLegacyAuth }, async (request, reply) => respond(reply, async()=>{const b=browserWaitBody.parse(request.body);return await ops.browserWait(b.sessionId,b.selector,b.timeoutMs);}));
  app.post('/actions/browser-console', { preHandler: requireLegacyAuth }, async (request, reply) => respond(reply, async()=>{const b=browserCursorBody.parse(request.body);return await ops.browserConsole(b.sessionId,b.cursor);}));
  app.post('/actions/browser-network', { preHandler: requireLegacyAuth }, async (request, reply) => respond(reply, async()=>{const b=browserCursorBody.parse(request.body);return await ops.browserNetwork(b.sessionId,b.cursor);}));
  app.post('/actions/browser-screenshot', { preHandler: requireLegacyAuth }, async (request, reply) => respond(reply, async()=>{const b=browserSessionBody.parse(request.body);return await ops.browserScreenshot(b.sessionId);}));
  app.post('/actions/browser-close', { preHandler: requireLegacyAuth }, async (request, reply) => respond(reply, async()=>{const b=browserSessionBody.parse(request.body);return await ops.browserClose(b.sessionId);}));

  // Compact GPT Actions surface. Granular routes above remain available for compatibility and MCP stays granular.
  app.post('/actions/fs', { preHandler: requireAuth }, async (request, reply) => respond(reply, async () => {
    const ops=scopedOps(request);
    const b=z.object({action:z.enum(['roots','list','read','write','edit']),root:z.string().optional(),path:z.string().optional(),offset:z.number().int().min(0).optional(),length:z.number().int().min(1).max(1000).optional(),content:z.string().optional(),mode:z.enum(['rewrite','append']).optional(),oldText:z.string().optional(),newText:z.string().optional(),replaceAll:z.boolean().optional()}).strict().parse(request.body);
    scope(request,b.action==='write'||b.action==='edit'?'fs.write':'fs.read'); if(b.action==='roots') return ops.listRoots(); if(!b.root) throw new Error('root is required.');
    if(b.action==='list') return ops.listDirectory(b.root,b.path??'.'); if(!b.path) throw new Error('path is required.');
    if(b.action==='read') return ops.readFile(b.root,b.path,b.offset??0,b.length??250);
    if(b.action==='write'){if(b.content===undefined)throw new Error('content is required.');return ops.writeFile(b.root,b.path,b.content,b.mode??'rewrite');}
    if(b.oldText===undefined||b.newText===undefined)throw new Error('oldText and newText are required.');return ops.editFile(b.root,b.path,b.oldText,b.newText,b.replaceAll??false);
  }));
  app.post('/actions/process', { preHandler: requireAuth }, async (request, reply) => respond(reply, async () => {
    const ops=scopedOps(request);
    const b=z.object({action:z.enum(['run','start','read','stop']),root:z.string().optional(),cwd:z.string().optional(),command:z.string().optional(),timeoutMs:z.number().int().min(100).optional(),processId:z.number().int().positive().optional(),cursor:z.number().int().min(0).optional()}).strict().parse(request.body);
    scope(request,b.action==='read'?'fs.read':'fs.write'); if(b.action==='run'||b.action==='start'){if(!b.root||!b.command)throw new Error('root and command are required.');return b.action==='run'?ops.runCommand(b.root,b.cwd??'.',b.command,b.timeoutMs):ops.startProcess(b.root,b.cwd??'.',b.command);}
    if(!b.processId)throw new Error('processId is required.');return b.action==='read'?ops.readProcessOutput(b.processId,b.cursor??0):ops.stopProcess(b.processId);
  }));
  app.post('/actions/git', { preHandler: requireAuth }, async (request, reply) => respond(reply, async () => {
    const ops=scopedOps(request);
    const b=z.object({action:z.enum(['status','diff','stage','commit','push','inspect']),root:z.string(),cwd:z.string().default('.'),staged:z.boolean().optional(),paths:z.array(z.string()).optional(),all:z.boolean().optional(),message:z.string().optional(),remote:z.string().optional(),branch:z.string().optional(),setUpstream:z.boolean().optional(),forceWithLease:z.boolean().optional()}).strict().parse(request.body);
    scope(request,b.action==='status'||b.action==='diff'||b.action==='inspect'?'fs.read':'fs.write'); switch(b.action){case'status':return ops.gitStatus(b.root,b.cwd);case'diff':return ops.gitDiff(b.root,b.cwd,b.staged??false);case'stage':return ops.gitStage(b.root,b.cwd,b.paths??[],b.all??false);case'commit':if(!b.message)throw new Error('message is required.');return ops.gitCommit(b.root,b.cwd,b.message);case'push':return ops.gitPush(b.root,b.cwd,b.remote??'origin',b.branch,b.setUpstream??false,b.forceWithLease??false);case'inspect':return ops.inspectRepository(b.root,b.cwd);}
  }));
  app.post('/actions/skills', { preHandler: requireAuth }, async (request, reply) => respond(reply, async () => {
    const ops=scopedOps(request); scope(request,'fs.read');
    const b=z.object({action:z.enum(['list','read','list_resources','read_resource','evaluate']),id:z.string().optional(),query:z.string().optional(),source:z.enum(['core','agent']).optional(),limit:z.number().int().min(1).max(200).optional(),path:z.string().optional()}).strict().parse(request.body);
    if(b.action==='list')return ops.listSkills(b.query??'',b.source,b.limit??50);if(!b.id)throw new Error('id is required.');if(b.action==='read')return ops.readSkill(b.id);if(b.action==='evaluate')return ops.evaluateSkill(b.id);if(b.action==='list_resources')return ops.listSkillResources(b.id);if(!b.path)throw new Error('path is required.');return ops.readSkillResource(b.id,b.path);
  }));
  app.post('/actions/memory', { preHandler: requireAuth }, async (request, reply) => respond(reply, async () => {
    const ops=scopedOps(request);
    const b=z.object({action:z.enum(['read','write','append_event','save_checkpoint','load_checkpoint']),root:z.string(),cwd:z.string().default('.'),name:z.string().optional(),content:z.string().optional(),event:z.record(z.string(),z.unknown()).optional(),checkpoint:z.record(z.string(),z.unknown()).optional()}).strict().parse(request.body);
    scope(request,b.action==='read'||b.action==='load_checkpoint'?'fs.read':'fs.write'); if(b.action==='load_checkpoint')return ops.loadCheckpoint(b.root,b.cwd);if(b.action==='append_event'){if(!b.event)throw new Error('event is required.');return ops.appendAgentEvent(b.root,b.cwd,b.event);}if(b.action==='save_checkpoint'){if(!b.checkpoint)throw new Error('checkpoint is required.');return ops.saveCheckpoint(b.root,b.cwd,b.checkpoint);}if(!b.name)throw new Error('name is required.');if(b.action==='read')return ops.readAgentMemory(b.root,b.cwd,b.name);if(b.content===undefined)throw new Error('content is required.');return ops.writeAgentMemory(b.root,b.cwd,b.name,b.content);
  }));
  app.post('/actions/engineering', { preHandler: requireAuth }, async (request, reply) => respond(reply, async () => {
    const ops=scopedOps(request);
    const b=z.object({action:z.enum(['health','capabilities','diagnose','bootstrap','environment','readiness','evidence','plan_work','database_capabilities','database','mission','worker','github']),root:z.string().optional(),cwd:z.string().optional(),goal:z.string().optional(),mode:z.enum(['auto','engineering','research','product','design_ux','strategy','mixed']).optional(),databaseAction:z.enum(['health','schema','query','explain']).optional(),connectionEnv:z.string().optional(),databaseEnvironment:z.enum(['development','staging','production']).optional(),sql:z.string().optional(),allowProductionWrite:z.boolean().optional(),missionAction:z.enum(['create','list','get','start','next','approve','verify','block','interrupt','resume','cancel','summary','resolve','set_alias','handoff_save','handoff_latest','handoff_list','resume_context','evidence_record','evidence_list']).optional(),missionId:z.string().optional(),alias:z.string().optional(),decisions:z.array(z.string()).optional(),blockers:z.array(z.string()).optional(),pendingQuestions:z.array(z.string()).optional(),nextActions:z.array(z.string()).optional(),branch:z.string().optional(),notes:z.string().optional(),steps:z.array(z.object({title:z.string().min(1),acceptance:z.array(z.string()).optional(),requiresApproval:z.boolean().optional()})).optional(),maxRemediationAttempts:z.number().int().min(1).max(20).optional(),stepId:z.string().optional(),approved:z.boolean().optional(),passed:z.boolean().optional(),summary:z.string().optional(),reason:z.string().optional(),metadata:z.record(z.string(),z.unknown()).optional(),kind:z.string().optional(),source:z.string().optional(),status:z.enum(['pass','fail','info','unknown']).optional(),data:z.record(z.string(),z.unknown()).optional(),workerAction:z.enum(['enqueue','list','get','claim','heartbeat','complete','fail','cancel','recover','status']).optional(),workId:z.string().optional(),workerId:z.string().optional(),leaseToken:z.string().optional(),leaseMs:z.number().int().min(1000).max(900000).optional(),workerKinds:z.array(z.string()).optional(),payload:z.record(z.string(),z.unknown()).optional(),maxAttempts:z.number().int().min(1).max(20).optional(),result:z.record(z.string(),z.unknown()).optional(),error:z.string().optional(),retry:z.boolean().optional(),githubAction:z.enum(['capabilities','repository','pull_requests','pull_request','create_pull_request','comment','checks','workflow_runs','issues','create_issue']).optional(),repository:z.string().optional(),number:z.number().int().positive().optional(),tokenEnv:z.string().optional(),title:z.string().optional(),body:z.string().optional(),head:z.string().optional(),base:z.string().optional(),state:z.enum(['open','closed','all']).optional(),limit:z.number().int().min(1).max(100).optional(),recordEvidence:z.boolean().optional()}).strict().parse(request.body);
    const readOnly=['health','capabilities','diagnose','bootstrap','environment','readiness','evidence','plan_work','database_capabilities'];scope(request,readOnly.includes(b.action)?'fs.read':'fs.write'); if(b.action==='health')return ops.health();if(b.action==='capabilities')return ops.capabilities();if(b.action==='diagnose')return ops.diagnoseRuntime();if(b.action==='bootstrap')return ops.agentBootstrap();if(b.action==='environment')return ops.environmentCapabilities();if(b.action==='worker'){if(!b.workerAction)throw new Error('workerAction is required.');return ops.workerOperation(b.workerAction,b);}if(b.action==='github'){if(!b.githubAction)throw new Error('githubAction is required.');return ops.githubOperation(b.githubAction,b);}if(b.action==='mission'){if(!b.missionAction)throw new Error('missionAction is required.');if(b.missionAction==='evidence_record'||b.missionAction==='evidence_list'){if(!b.missionId)throw new Error('missionId is required.');return ops.evidenceOperation(b.missionAction==='evidence_record'?'record':'list',{missionId:b.missionId,stepId:b.stepId,kind:b.kind,source:b.source,status:b.status,summary:b.summary,data:b.data});}return ops.missionOperation(b.missionAction,b);}if(b.action==='database_capabilities')return ops.databaseCapabilities();if(b.action==='database'){if(!b.databaseAction||!b.connectionEnv||!b.databaseEnvironment)throw new Error('databaseAction, connectionEnv and databaseEnvironment are required.');return ops.databaseOperation(b.databaseAction,b.connectionEnv,b.databaseEnvironment,b.sql,b.allowProductionWrite??false);}if(b.action==='plan_work'){if(!b.goal)throw new Error('goal is required.');return ops.planWork(b.goal,b.mode??'auto');}if(!b.root)throw new Error('root is required.');return b.action==='readiness'?ops.projectReadiness(b.root,b.cwd??'.'):ops.engineeringEvidence(b.root,b.cwd??'.');
  }));
  app.post('/actions/browser', { preHandler: requireAuth }, async (request, reply) => respond(reply, async () => {
    const ops=scopedOps(request); scope(request,'fs.write');
    const b=z.object({action:z.enum(['start','navigate','snapshot','click','type','wait','console','network','screenshot','viewport','accessibility','performance','close']),sessionId:z.number().int().positive().optional(),headless:z.boolean().optional(),executablePath:z.string().optional(),url:z.string().url().optional(),waitUntil:z.enum(['load','domcontentloaded','networkidle']).optional(),selector:z.string().optional(),value:z.string().optional(),pressEnter:z.boolean().optional(),timeoutMs:z.number().int().min(0).max(30000).optional(),cursor:z.number().int().min(0).optional(),width:z.number().int().min(240).max(7680).optional(),height:z.number().int().min(240).max(4320).optional()}).strict().parse(request.body);
    if(b.action==='start')return ops.browserStart(b.headless??true,b.executablePath);if(!b.sessionId)throw new Error('sessionId is required.');switch(b.action){case'navigate':if(!b.url)throw new Error('url is required.');return ops.browserNavigate(b.sessionId,b.url,b.waitUntil??'domcontentloaded');case'snapshot':return ops.browserSnapshot(b.sessionId);case'click':if(!b.selector)throw new Error('selector is required.');return ops.browserClick(b.sessionId,b.selector);case'type':if(!b.selector||b.value===undefined)throw new Error('selector and value are required.');return ops.browserType(b.sessionId,b.selector,b.value,b.pressEnter??false);case'wait':return ops.browserWait(b.sessionId,b.selector,b.timeoutMs??5000);case'console':return ops.browserConsole(b.sessionId,b.cursor??0);case'network':return ops.browserNetwork(b.sessionId,b.cursor??0);case'screenshot':return ops.browserScreenshot(b.sessionId);case'viewport':if(!b.width||!b.height)throw new Error('width and height are required.');return ops.browserViewport(b.sessionId,b.width,b.height);case'accessibility':return ops.browserAccessibility(b.sessionId);case'performance':return ops.browserPerformance(b.sessionId);case'close':return ops.browserClose(b.sessionId);}
  }));
}