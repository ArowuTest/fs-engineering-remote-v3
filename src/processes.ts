import { spawn, spawnSync, type ChildProcessWithoutNullStreams } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export interface ProcessRunTelemetry {
  command: string;
  cwd: string;
  exitCode: number | null;
  timedOut: boolean;
  spawnLatencyMs: number;
  executionMs: number;
  durationMs: number;
}

interface ProcessManagerOptions {
  shell: string;
  maxOutputBytes: number;
  stateDir?: string;
  sessionRetentionMs?: number;
  maxPersistedSessions?: number;
  onRun?: (event: ProcessRunTelemetry) => void;
}

const EXECUTION_SESSION_SCHEMA = 'fs-remote.exec-session.v1';

interface Job {
  id: number;
  sessionId: string;
  child: ChildProcessWithoutNullStreams;
  logPath?: string;
  chunks: string[];
  bytes: number;
  status: 'running' | 'exited' | 'killed';
  exitCode: number | null;
  startedAt: string;
  lastActivityAt: string;
  command: string;
  cwd: string;
}

export interface RunResult {
  exitCode: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  spawnLatencyMs: number;
  executionMs: number;
  durationMs: number;
}

const SENSITIVE_COMMAND_ENV = new Set([
  'DATABASE_URL','DATABASE_PUBLIC_URL','PGPASSWORD','MONGODB_URI','MONGO_URL','REDIS_URL',
  'SSH_AUTH_SOCK','SSH_ASKPASS','GIT_ASKPASS','GIT_ASKPASS_REQUIRE','GIT_CONFIG_GLOBAL',
  'KUBECONFIG','DOCKER_CONFIG','GOOGLE_APPLICATION_CREDENTIALS','AWS_SHARED_CREDENTIALS_FILE',
  'AWS_WEB_IDENTITY_TOKEN_FILE','AZURE_FEDERATED_TOKEN_FILE',
]);
function sensitiveCommandEnvironmentName(name:string):boolean{
  const key=name.toUpperCase();
  return SENSITIVE_COMMAND_ENV.has(key)
    || /(?:^|_)(?:TOKEN|SECRET|PASSWORD|PASSWD|API_KEY|PRIVATE_KEY|ACCESS_KEY|CREDENTIAL|CREDENTIALS)(?:_|$)/.test(key);
}
export function sanitizedCommandEnvironment(additions:NodeJS.ProcessEnv={}): NodeJS.ProcessEnv {
  const env:NodeJS.ProcessEnv={};
  for(const [name,value] of Object.entries(process.env))if(!sensitiveCommandEnvironmentName(name))env[name]=value;
  for(const [name,value] of Object.entries(additions))if(!sensitiveCommandEnvironmentName(name))env[name]=value;
  const comspec = process.env.ComSpec ?? process.env.COMSPEC ?? 'C:\\Windows\\System32\\cmd.exe';
  env.ComSpec=comspec;env.COMSPEC=comspec;
  if(process.platform==='win32'){const systemRoot=process.env.SystemRoot??process.env.SYSTEMROOT??'C:\\Windows',required=[`${systemRoot}\\System32\\WindowsPowerShell\\v1.0`,`${systemRoot}\\System32`],current=env.Path??env.PATH??'',parts=current.split(';').filter(Boolean),lower=new Set(parts.map(x=>x.toLowerCase()));for(const p of required)if(!lower.has(p.toLowerCase()))parts.unshift(p);env.Path=parts.join(';');env.PATH=env.Path;}
  return env;
}

const COMMAND_SECRET_NAME='(?:token|secret|password|passwd|api[-_]?key|private[-_]?key|access[-_]?key|credential|credentials)';
export function redactCommand(command:string):string{
  let value=command;
  value=value.replace(new RegExp(`((?:--?${COMMAND_SECRET_NAME}|[A-Z0-9_]*(?:TOKEN|SECRET|PASSWORD|PASSWD|API[_-]?KEY|PRIVATE[_-]?KEY|ACCESS[_-]?KEY|CREDENTIALS?)[A-Z0-9_]*)\\s*(?:=|:)\\s*)([^\\s"';&|]+)`,'gi'),'$1[REDACTED]');
  value=value.replace(new RegExp(`((?:--?${COMMAND_SECRET_NAME})\\s+)([^\\s"';&|]+)`,'gi'),'$1[REDACTED]');
  value=value.replace(/(bearer\s+)[A-Za-z0-9._~+\/=:-]{8,}/gi,'$1[REDACTED]');
  value=value.replace(/(https?:\/\/[^:\s\/]+:)[^@\s]+(@)/gi,'$1[REDACTED]$2');
  return value;
}

export function resolveCommandShell(shell: string, platform = process.platform, env = process.env): string {
  if (platform !== 'win32') return shell;
  if (shell.toLowerCase()==='powershell.exe') return 'powershell.exe';
  return shell;
}

function shellArgs(shell: string, command: string, platform = process.platform): string[] {
  const name = shell.toLowerCase();
  if (platform === 'win32' && (name.endsWith('cmd.exe') || name === 'cmd')) return ['/d', '/s', '/c', command];
  if (name.includes('powershell') || name.includes('pwsh')) return ['-NoProfile', '-Command', command];
  return ['-lc', command];
}
export class ProcessManager {
  private readonly jobs = new Map<number, Job>();
  private readonly sessions = new Map<string, Job>();
  constructor(private readonly options: ProcessManagerOptions) {
    if (options.stateDir) {
      fs.mkdirSync(options.stateDir, { recursive: true });
      this.reconcilePersistedSessions();
      this.prunePersistedSessions();
    }
  }

  private reconcilePersistedSessions(): void {
    if (!this.options.stateDir) return;
    for (const name of fs.readdirSync(this.options.stateDir).filter((x) => x.endsWith('.json'))) {
      const target=path.join(this.options.stateDir,name);
      try {
        const item=JSON.parse(fs.readFileSync(target,'utf8'));
        if (item.status !== 'running') continue;
        item.status='interrupted'; item.alive=false; item.interruptedAt=new Date().toISOString(); item.interruptionReason='runtime_restarted'; item.schemaVersion=item.schemaVersion??EXECUTION_SESSION_SCHEMA;
        const temp=`${target}.${process.pid}.tmp`; fs.writeFileSync(temp,JSON.stringify(item,null,2),'utf8'); fs.renameSync(temp,target);
      } catch { /* malformed historical metadata remains isolated from runtime startup */ }
    }
  }

  private prunePersistedSessions(): void {
    if (!this.options.stateDir) return;
    const retention=this.options.sessionRetentionMs??7*24*60*60*1000; const max=this.options.maxPersistedSessions??250; const now=Date.now();
    const items=fs.readdirSync(this.options.stateDir).filter((x)=>x.endsWith('.json')).map((name)=>{const p=path.join(this.options.stateDir!,name);try{const data=JSON.parse(fs.readFileSync(p,'utf8'));return{name,p,data,time:Date.parse(data.lastActivityAt??data.startedAt??'')||0};}catch{return{name,p,data:null,time:0};}}).sort((a,b)=>b.time-a.time);
    for (let i=0;i<items.length;i++) { const item=items[i]; if(!item.data||item.data.status==='running')continue; if(i<max && now-item.time<=retention)continue; const sid=String(item.data.sessionId??item.name.replace(/\.json$/,'')); for(const ext of ['.json','.jsonl']){const f=path.join(this.options.stateDir,`${sid}${ext}`);try{fs.rmSync(f,{force:true});}catch{}} }
  }

  private newSessionId(): string {
    return `exec-${Date.now().toString(36)}-${crypto.randomBytes(4).toString('hex')}`;
  }

  private persist(job: Job): void {
    if (!this.options.stateDir) return;
    const meta = { schemaVersion:EXECUTION_SESSION_SCHEMA, sessionId:job.sessionId, processId:job.id, status:job.status, exitCode:job.exitCode, startedAt:job.startedAt, lastActivityAt:job.lastActivityAt, command:job.command, cwd:job.cwd, alive:job.status==='running', logPath:job.logPath };
    const target=path.join(this.options.stateDir, `${job.sessionId}.json`); const temp=`${target}.${process.pid}.tmp`;
    fs.writeFileSync(temp, JSON.stringify(meta, null, 2), 'utf8');
    fs.renameSync(temp, target);
  }

  private appendLog(job: Job, stream: 'stdout'|'stderr', text: string): void {
    if (!job.logPath) return;
    fs.appendFileSync(job.logPath, JSON.stringify({ at:new Date().toISOString(), stream, text })+'\n', 'utf8');
  }

  async run(command: string, cwd: string, timeoutMs: number): Promise<RunResult> {
    return await new Promise((resolve) => {
      const started = performance.now();
      let spawnedAt: number | null = null;
      const shell = resolveCommandShell(this.options.shell);
      const child = spawn(shell, shellArgs(shell, command), {
        cwd,
        env: sanitizedCommandEnvironment(),
        windowsHide: true,
      });
      child.once('spawn', () => { spawnedAt = performance.now(); });
      let stdout = '';
      let stderr = '';
      let timedOut = false;
      let settled = false;
      const append = (current: string, data: Buffer): string => {
        const next = current + data.toString('utf8');
        return Buffer.byteLength(next) > this.options.maxOutputBytes
          ? next.slice(-this.options.maxOutputBytes)
          : next;
      };
      child.stdout.on('data', (data: Buffer) => { stdout = append(stdout, data); });
      child.stderr.on('data', (data: Buffer) => { stderr = append(stderr, data); });
      const timer = setTimeout(() => {
        timedOut = true;
        this.killTree(child.pid ?? 0);
      }, timeoutMs);
      child.on('error', (error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        const ended = performance.now(), telemetry={command:redactCommand(command),cwd,exitCode:null,timedOut:false,spawnLatencyMs:ended-started,executionMs:0,durationMs:ended-started};
        stderr = append(stderr, Buffer.from(`Failed to spawn ${shell}: ${error.message}\n`, 'utf8'));
        try { this.options.onRun?.(telemetry); } catch { /* telemetry must never affect command execution */ }
        resolve({ exitCode: null, stdout, stderr, timedOut: false, spawnLatencyMs: telemetry.spawnLatencyMs, executionMs: telemetry.executionMs, durationMs: telemetry.durationMs });
      });
      child.on('close', (code) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        const ended = performance.now(), actualSpawnedAt = spawnedAt ?? started, telemetry={command:redactCommand(command),cwd,exitCode:code,timedOut,spawnLatencyMs:Math.max(0,actualSpawnedAt-started),executionMs:Math.max(0,ended-actualSpawnedAt),durationMs:Math.max(0,ended-started)};
        try { this.options.onRun?.(telemetry); } catch { /* telemetry must never affect command execution */ }
        resolve({ exitCode: code, stdout, stderr, timedOut, spawnLatencyMs: telemetry.spawnLatencyMs, executionMs: telemetry.executionMs, durationMs: telemetry.durationMs });
      });
    });
  }

  start(command: string, cwd: string): { processId: number; sessionId: string } {
    const shell = resolveCommandShell(this.options.shell);
    const child = spawn(shell, shellArgs(shell, command), {
      cwd,
      env: sanitizedCommandEnvironment(),
      windowsHide: true,
    });
    // A spawn failure is emitted asynchronously. Always attach an error listener so
    // ENOENT/EACCES can never become an unhandled process-level event.
    child.on('error', () => { /* handled below or by the no-pid start failure */ });
    if (!child.pid) {
      // Keep the listener attached: Node may emit the spawn error after this return path.
      throw new Error('Failed to start process.');
    }
    const sessionId = this.newSessionId();
    const job: Job = {
      id: child.pid,
      sessionId,
      child,
      logPath: this.options.stateDir ? path.join(this.options.stateDir, `${sessionId}.jsonl`) : undefined,
      chunks: [],
      bytes: 0,
      status: 'running',
      exitCode: null,
      startedAt: new Date().toISOString(),
      lastActivityAt: new Date().toISOString(),
      command: redactCommand(command),
      cwd,
    };
    const add = (label: string, data: Buffer) => {
      let text = `${label}${data.toString('utf8')}`;
      const room = this.options.maxOutputBytes - job.bytes;
      if (room <= 0) return;
      if (Buffer.byteLength(text) > room) text = text.slice(0, room);
      job.chunks.push(text);
      job.bytes += Buffer.byteLength(text);
      job.lastActivityAt = new Date().toISOString();
      this.appendLog(job, label ? 'stderr' : 'stdout', data.toString('utf8'));
      this.persist(job);
    };
    child.stdout.on('data', (data: Buffer) => add('', data));
    child.stderr.on('data', (data: Buffer) => add('[stderr] ', data));
    child.on('close', (code) => {
      job.exitCode = code;
      if (job.status === 'running') job.status = 'exited';
      job.lastActivityAt = new Date().toISOString();
      this.persist(job);
    });
    this.jobs.set(job.id, job);
    this.sessions.set(job.sessionId, job);
    this.persist(job);
    return { processId: job.id, sessionId: job.sessionId };
  }

  read(processId: number, cursor = 0): {
    status: Job['status'];
    exitCode: number | null;
    output: string;
    nextCursor: number;
    processId: number;
    startedAt: string;
    lastActivityAt: string;
    command: string;
    cwd: string;
    alive: boolean;
  } {
    const job = this.jobs.get(processId);
    if (!job) throw new Error(`Unknown process: ${processId}`);
    const safeCursor = Math.max(0, Math.min(cursor, job.chunks.length));
    return {
      status: job.status,
      exitCode: job.exitCode,
      output: job.chunks.slice(safeCursor).join(''),
      nextCursor: job.chunks.length,
      processId: job.id,
      startedAt: job.startedAt,
      lastActivityAt: job.lastActivityAt,
      command: job.command,
      cwd: job.cwd,
      alive: job.status === 'running',
    };
  }

  stop(processId: number): boolean {
    const job = this.jobs.get(processId);
    if (!job || job.status !== 'running') return false;
    job.status = 'killed';
    job.lastActivityAt = new Date().toISOString();
    this.persist(job);
    this.killTree(processId);
    return true;
  }

  writeSession(sessionId: string, input: string, appendNewline = false): { sessionId:string; processId:number; writtenBytes:number } {
    const job=this.sessions.get(sessionId); if(!job)throw new Error(`Unknown or non-live execution session: ${sessionId}`); if(job.status!=='running'||!job.child.stdin.writable)throw new Error(`Execution session is not writable: ${sessionId}`);
    const text=input+(appendNewline?'\n':''); job.child.stdin.write(text); job.lastActivityAt=new Date().toISOString(); this.persist(job); return {sessionId,processId:job.id,writtenBytes:Buffer.byteLength(text)};
  }

  cancelSession(sessionId: string): { sessionId:string; processId:number; cancelled:boolean } {
    const job=this.sessions.get(sessionId); if(!job)return {sessionId,processId:0,cancelled:false}; const cancelled=this.stop(job.id); return {sessionId,processId:job.id,cancelled};
  }

  listSessions(): Array<Record<string, unknown>> {
    const live = [...this.sessions.values()].map((job) => ({ schemaVersion:EXECUTION_SESSION_SCHEMA, sessionId:job.sessionId, processId:job.id, status:job.status, exitCode:job.exitCode, startedAt:job.startedAt, lastActivityAt:job.lastActivityAt, command:job.command, cwd:job.cwd, alive:job.status==='running' }));
    if (!this.options.stateDir) return live;
    const known = new Set(live.map((x) => x.sessionId));
    for (const name of fs.readdirSync(this.options.stateDir).filter((x) => x.endsWith('.json'))) {
      try { const item=JSON.parse(fs.readFileSync(path.join(this.options.stateDir,name),'utf8')); if(!known.has(item.sessionId)) live.push({...item,alive:false,status:item.status==='running'?'interrupted':item.status}); } catch { /* ignore corrupt metadata */ }
    }
    return live.sort((a,b)=>String(b.startedAt).localeCompare(String(a.startedAt)));
  }

  readSession(sessionId: string, cursor = 0, maxRecords = 200): Record<string, unknown> {
    if (!/^[A-Za-z0-9._-]+$/.test(sessionId)) throw new Error('Invalid session ID.');
    const live=this.sessions.get(sessionId); let meta:any=live?{sessionId:live.sessionId,processId:live.id,status:live.status,exitCode:live.exitCode,startedAt:live.startedAt,lastActivityAt:live.lastActivityAt,command:live.command,cwd:live.cwd,alive:live.status==='running'}:null;
    if (!meta && this.options.stateDir) { const p=path.join(this.options.stateDir,`${sessionId}.json`); if(fs.existsSync(p)){meta=JSON.parse(fs.readFileSync(p,'utf8'));if(meta.status==='running'){meta.status='interrupted';meta.alive=false;}} }
    if (!meta) throw new Error(`Unknown execution session: ${sessionId}`);
    const logPath=this.options.stateDir?path.join(this.options.stateDir,`${sessionId}.jsonl`):undefined; const rows=logPath&&fs.existsSync(logPath)?fs.readFileSync(logPath,'utf8').split(/\r?\n/).filter(Boolean):[]; const safe=Math.max(0,Math.min(cursor,rows.length)); const selected=rows.slice(safe,safe+Math.max(1,Math.min(maxRecords,1000))).map((x)=>JSON.parse(x));
    return {...meta,records:selected,nextCursor:safe+selected.length,totalRecords:rows.length,truncated:safe+selected.length<rows.length};
  }

  private killTree(processId: number): void {
    if (!processId) return;
    if (process.platform === 'win32') {
      spawnSync('taskkill.exe', ['/PID', String(processId), '/T', '/F'], { windowsHide: true });
      return;
    }
    try { process.kill(processId, 'SIGTERM'); } catch { /* already exited */ }
  }
}

