import { SERVICE_VERSION } from './version.js';

type JsonSchema = Record<string, unknown>;

const string = (description?: string): JsonSchema => ({
  type: 'string',
  ...(description ? { description } : {}),
});
const integer = (description?: string): JsonSchema => ({
  type: 'integer',
  ...(description ? { description } : {}),
});
const boolean = (description?: string): JsonSchema => ({
  type: 'boolean',
  ...(description ? { description } : {}),
});
const ref = (name: string): JsonSchema => ({ $ref: `#/components/schemas/${name}` });
const arrayOf = (items: JsonSchema): JsonSchema => ({ type: 'array', items });

const errorResponse = {
  description: 'Request rejected.',
  content: { 'application/json': { schema: ref('ErrorResponse') } },
};

function responses(successSchema: JsonSchema) {
  return {
    '200': {
      description: 'Operation completed.',
      content: { 'application/json': { schema: successSchema } },
    },
    '400': errorResponse,
    '401': errorResponse,
  };
}
function postAction(
  operationId: string,
  summary: string,
  properties: Record<string, JsonSchema>,
  required: string[],
  successSchema: JsonSchema,
) {
  return {
    post: {
      operationId,
      summary,
      security: [{ bearerAuth: [] }],
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: {
              type: 'object',
              properties,
              required,
              additionalProperties: false,
            },
          },
        },
      },
      responses: responses(successSchema),
    },
  };
}

function getAction(operationId: string, summary: string, successSchema: JsonSchema) {
  return {
    get: {
      operationId,
      summary,
      security: [{ bearerAuth: [] }],
      responses: responses(successSchema),
    },
  };
}

const schemas: Record<string, JsonSchema> = {
  ErrorResponse: {
    type: 'object',
    properties: { error: string('Human-readable error message.') },
    required: ['error'],
    additionalProperties: false,
  },
  HealthResult: {
    type: 'object',
    properties: {
      ok: boolean(),
      platform: string(),
      roots: integer(),
    },
    required: ['ok', 'platform', 'roots'],
    additionalProperties: false,
  },
  RootInfo: {
    type: 'object',
    properties: {
      name: string(),
      path: string(),
      readOnly: boolean(),
      allowSecrets: boolean(),
    },
    required: ['name', 'path', 'readOnly', 'allowSecrets'],
    additionalProperties: false,
  },
  DirectoryEntry: {
    type: 'object',
    properties: {
      name: string(),
      type: { type: 'string', enum: ['file', 'directory'] },
      size: integer(),
      modified: string(),
    },
    required: ['name', 'type', 'size', 'modified'],
    additionalProperties: false,
  },
  ReadFileResult: {
    type: 'object',
    properties: {
      path: string(),
      offset: integer(),
      length: integer(),
      totalLines: integer(),
      content: string(),
    },
    required: ['path', 'offset', 'length', 'totalLines', 'content'],
    additionalProperties: false,
  },
  WriteFileResult: {
    type: 'object',
    properties: {
      ok: boolean(),
      path: string(),
      bytes: integer(),
      mode: { type: 'string', enum: ['rewrite', 'append'] },
    },
    required: ['ok', 'path', 'bytes', 'mode'],
    additionalProperties: false,
  },
  EditFileResult: {
    type: 'object',
    properties: {
      ok: boolean(),
      path: string(),
      replacements: integer(),
    },
    required: ['ok', 'path', 'replacements'],
    additionalProperties: false,
  },
  RunResult: {
    type: 'object',
    properties: {
      exitCode: { oneOf: [integer(), { type: 'null' }] },
      stdout: string(),
      stderr: string(),
      timedOut: boolean(),
    },
    required: ['exitCode', 'stdout', 'stderr', 'timedOut'],
    additionalProperties: false,
  },
  StartProcessResult: {
    type: 'object',
    properties: { processId: integer() },
    required: ['processId'],
    additionalProperties: false,
  },
  ProcessOutputResult: {
    type: 'object',
    properties: {
      status: { type: 'string', enum: ['running', 'exited', 'killed'] },
      exitCode: { oneOf: [integer(), { type: 'null' }] },
      output: string(), nextCursor: integer(), processId: integer(), startedAt: string(), lastActivityAt: string(),
      command: string(), cwd: string(), alive: boolean(),
    },
    required: ['status', 'exitCode', 'output', 'nextCursor', 'processId', 'startedAt', 'lastActivityAt', 'command', 'cwd', 'alive'],
    additionalProperties: false,
  },
  StopProcessResult: {
    type: 'object',
    properties: {
      stopped: boolean(),
      processId: integer(),
    },
    required: ['stopped', 'processId'],
    additionalProperties: false,
  },
  SkillSummary: {
    type: 'object',
    properties: {
      id: string(),
      name: string(),
      description: string(),
      source: { type: 'string', enum: ['core', 'agent'] },
      entrypoint: string(),
    },
    required: ['id', 'name', 'description', 'source', 'entrypoint'],
    additionalProperties: false,
  },
  SkillDetail: {
    type: 'object',
    properties: {
      id: string(),
      name: string(),
      description: string(),
      source: { type: 'string', enum: ['core', 'agent'] },
      entrypoint: string(),
      content: string(),
    },
    required: ['id', 'name', 'description', 'source', 'entrypoint', 'content'],
    additionalProperties: false,
  },
  SkillResourceSummary: {
    type: 'object',
    properties: {
      path: string(),
      size: integer(),
    },
    required: ['path', 'size'],
    additionalProperties: false,
  },
  SkillResourceDetail: {
    type: 'object',
    properties: {
      skillId: string(),
      path: string(),
      size: integer(),
      content: string(),
    },
    required: ['skillId', 'path', 'size', 'content'],
    additionalProperties: false,
  },
  CapabilitiesResult: {
    type: 'object',
    properties: {
      service: string(),
      version: string(),
      platform: string(),
      execution: {
        type: 'object',
        properties: { shell: string(), longRunningProcesses: boolean() },
        required: ['shell', 'longRunningProcesses'],
        additionalProperties: false,
      },
      tools: {
        type: 'object',
        properties: {
          filesystem: arrayOf(string()),
          commands: arrayOf(string()),
          processes: arrayOf(string()),
          git: arrayOf(string()),
          memory: arrayOf(string()),
          engineering: arrayOf(string()),
          environment: arrayOf(string()),
          browser: arrayOf(string()),
          skills: arrayOf(string()),
          agent: arrayOf(string()),
        },
        required: ['filesystem', 'commands', 'processes', 'git', 'memory', 'engineering', 'environment', 'browser', 'skills', 'agent'],
        additionalProperties: false,
      },
      policies: {
        type: 'object',
        properties: {
          gitPush: boolean(), rawGitPushAllowed: boolean(), forcePushRequiresExplicitToolFlag: boolean(), deploymentCommandsAllowed: boolean(),
          dangerousSystemCommandsBlocked: boolean(),
          rootConfinement: boolean(),
          commandTimeoutMs: integer(),
          maxOutputBytes: integer(),
        },
        required: ['gitPush', 'rawGitPushAllowed', 'forcePushRequiresExplicitToolFlag', 'deploymentCommandsAllowed', 'dangerousSystemCommandsBlocked', 'rootConfinement', 'commandTimeoutMs', 'maxOutputBytes'],
        additionalProperties: false,
      },
      roots: integer(),
      skills: {
        type: 'object',
        properties: { total: integer(), core: integer(), agent: integer() },
        required: ['total', 'core', 'agent'],
        additionalProperties: false,
      },
    },
    required: ['service', 'version', 'platform', 'execution', 'tools', 'policies', 'roots', 'skills'],
    additionalProperties: false,
  },
  RuntimeDiagnosticsResult: {
    type: 'object',
    properties: {
      agent: string(), version: string(), environment: string(), endpoint: string(),
      server: string(), server_process: string(), health_endpoint: string(), port: integer(),
      cloudflared: string(), tunnel: string(), external_endpoint: string(), openapi: string(),
      actions_auth: string(), summary: string(),
    },
    required: ['agent', 'version', 'environment', 'endpoint', 'server', 'server_process', 'health_endpoint', 'port', 'cloudflared', 'tunnel', 'external_endpoint', 'openapi', 'actions_auth', 'summary'],
    additionalProperties: false,
  },
  AgentBootstrapResult: {
    type: 'object',
    properties: {
      role: string(),
      mission: string(),
      capabilityDiscovery: string(),
      skillLoading: string(),
      repositoryPolicy: string(),
      tddPolicy: string(),
      commitPolicy: string(),
      deliveryPolicy: string(),
      memoryPolicy: string(),
      reviewPolicy: string(),
      verificationPolicy: string(),
      continuityPolicy: string(),
    },
    required: ['role', 'mission', 'capabilityDiscovery', 'skillLoading', 'repositoryPolicy', 'tddPolicy', 'commitPolicy', 'deliveryPolicy', 'memoryPolicy', 'reviewPolicy', 'verificationPolicy', 'continuityPolicy'],
    additionalProperties: false,
  },
};

export function createOpenApiDocument(baseUrl: string) {
  return {
    openapi: '3.1.0',
    info: {
      title: 'FS Remote Actions',
      version: SERVICE_VERSION,
      description: 'Controlled local development operations on the configured FS Remote computer.',
    },
    servers: [{ url: baseUrl.replace(/\/$/, '') }],
    paths: {
      '/actions/fs': postAction('filesystemOperation','Compact filesystem operation: roots, list, read, write, or edit.',{action:{type:'string',enum:['roots','list','read','write','edit']},root:string(),path:string(),offset:integer(),length:integer(),content:string(),mode:{type:'string',enum:['rewrite','append']},oldText:string(),newText:string(),replaceAll:boolean()},['action'],{type:'object',properties:{result:{}},additionalProperties:true}),
      '/actions/process': postAction('processOperation','Compact command/process operation: run, start, read output, or stop.',{action:{type:'string',enum:['run','start','read','stop']},root:string(),cwd:string(),command:string(),timeoutMs:integer(),processId:integer(),cursor:integer()},['action'],{type:'object',properties:{result:{}},additionalProperties:true}),
      '/actions/git': postAction('gitOperation','Compact Git operation: status, diff, stage, commit, push, or inspect repository.',{action:{type:'string',enum:['status','diff','stage','commit','push','inspect']},root:string(),cwd:string(),staged:boolean(),paths:{type:'array',items:string()},all:boolean(),message:string(),remote:string(),branch:string(),setUpstream:boolean(),forceWithLease:boolean()},['action','root'],{type:'object',properties:{result:{}},additionalProperties:true}),
      '/actions/skills': postAction('skillOperation','Compact skill operation: list/search, read, list resources, or read a governed resource.',{action:{type:'string',enum:['list','read','list_resources','read_resource','evaluate']},id:string(),query:string(),source:{type:'string',enum:['core','agent']},limit:integer(),path:string()},['action'],{type:'object',properties:{result:{}},additionalProperties:true}),
      '/actions/memory': postAction('memoryOperation','Compact persistent agent memory/checkpoint operation.',{action:{type:'string',enum:['read','write','append_event','save_checkpoint','load_checkpoint']},root:string(),cwd:string(),name:string(),content:string(),event:{type:'object',additionalProperties:true},checkpoint:{type:'object',additionalProperties:true}},['action','root'],{type:'object',properties:{result:{}},additionalProperties:true}),
      '/actions/engineering': postAction('engineeringOperation','Compact engineering control plane: health, capabilities, runtime diagnosis, bootstrap, environment discovery, readiness, evidence, or intelligent work planning.',{action:{type:'string',enum:['health','capabilities','diagnose','bootstrap','environment','readiness','evidence','plan_work','database_capabilities','database','mission','worker','github']},root:string(),cwd:string(),goal:string(),mode:{type:'string',enum:['auto','engineering','research','product','design_ux','strategy','mixed']},databaseAction:{type:'string',enum:['health','schema','query','explain']},connectionEnv:string(),databaseEnvironment:{type:'string',enum:['development','staging','production']},sql:string(),allowProductionWrite:boolean(),missionAction:{type:'string',enum:['create','list','get','start','next','approve','verify','block','resume','cancel','summary','resolve','set_alias','handoff_save','handoff_latest','handoff_list','resume_context','evidence_record','evidence_list']},missionId:string(),alias:string(),decisions:{type:'array',items:string()},blockers:{type:'array',items:string()},pendingQuestions:{type:'array',items:string()},nextActions:{type:'array',items:string()},branch:string(),notes:string(),steps:{type:'array',items:{type:'object',properties:{title:string(),acceptance:{type:'array',items:string()},requiresApproval:boolean()},required:['title'],additionalProperties:false}},maxRemediationAttempts:integer(),stepId:string(),approved:boolean(),passed:boolean(),summary:string(),reason:string(),metadata:{type:'object',additionalProperties:true},kind:string(),source:string(),status:{type:'string',enum:['pass','fail','info','unknown']},data:{type:'object',additionalProperties:true},workerAction:{type:'string',enum:['enqueue','list','get','claim','heartbeat','complete','fail','cancel','recover','status']},workId:string(),workerId:string(),leaseToken:string(),leaseMs:integer(),workerKinds:{type:'array',items:string()},payload:{type:'object',additionalProperties:true},maxAttempts:integer(),result:{type:'object',additionalProperties:true},error:string(),retry:boolean(),githubAction:{type:'string',enum:['capabilities','repository','pull_requests','pull_request','create_pull_request','comment','checks','workflow_runs','issues','create_issue']},repository:string(),number:integer(),tokenEnv:string(),title:string(),body:string(),head:string(),base:string(),state:{type:'string',enum:['open','closed','all']},limit:integer(),recordEvidence:boolean()},['action'],{type:'object',properties:{result:{}},additionalProperties:true}),
      '/actions/browser': postAction('browserOperation','Compact governed browser operation: start, navigate, snapshot, click, type, wait, console, network, screenshot, or close.',{action:{type:'string',enum:['start','navigate','snapshot','click','type','wait','console','network','screenshot','viewport','accessibility','performance','close']},sessionId:integer(),headless:boolean(),executablePath:string(),url:string(),waitUntil:{type:'string',enum:['load','domcontentloaded','networkidle']},selector:string(),value:string(),pressEnter:boolean(),timeoutMs:integer(),cursor:integer(),width:integer(),height:integer()},['action'],{type:'object',properties:{result:{}},additionalProperties:true}),
    },    components: {
      securitySchemes: {
        bearerAuth: {
          type: 'http',
          scheme: 'bearer',
          description: 'Use the FS Remote Actions API key.',
        },
      },
      schemas,
    },
  };
}


