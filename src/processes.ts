import { spawn, spawnSync, type ChildProcessWithoutNullStreams } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

interface ProcessManagerOptions {
  shell: string;
  maxOutputBytes: number;
  stateDir?: string;
  sessionRetentionMs?: number;
  maxPersistedSessions?: number;
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
}

function commandEnvironment(): NodeJS.ProcessEnv {
  const comspec = process.env.ComSpec ?? process.env.COMSPEC ?? 'C:\\Windows\\System32\\cmd.exe';
  return { ...process.env, ComSpec: comspec, COMSPEC: comspec };
}

export function resolveCommandShell(shell: string, platform = process.platform, env = process.env): string {
  if (platform !== 'win32' || shell.toLowerCase() !== 'powershell.exe') return shell;
  const candidates=[env.SystemRoot,env.SYSTEMROOT,'C:\\Windows'].filter((x):x is string=>Boolean(x)).map(x=>`${x}\\System32\\WindowsPowerShell\\v1.0\\powershell.exe`);
  return candidates.find(x=>fs.existsSync(x))??'powershell.exe';
}

function shellArgs(shell: string, command: string, platform = process.platform): string[] {
  const name = shell.toLowerCase();
  if (platform === 'win32' || name.includes('powershell') || name.includes('pwsh')) return ['-NoProfile', '-Command', command];
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
      const shell = resolveCommandShell(this.options.shell);
      const child = spawn(shell, shellArgs(shell, command), {
        cwd,
        env: commandEnvironment(),
        windowsHide: true,
      });
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
        stderr = append(stderr, Buffer.from(`Failed to spawn ${shell}: ${error.message}\n`, 'utf8'));
        resolve({ exitCode: null, stdout, stderr, timedOut: false });
      });
      child.on('close', (code) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve({ exitCode: code, stdout, stderr, timedOut });
      });
    });
  }

  start(command: string, cwd: string): { processId: number; sessionId: string } {
    const shell = resolveCommandShell(this.options.shell);
    const child = spawn(shell, shellArgs(shell, command), {
      cwd,
      env: commandEnvironment(),
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
      command,
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

