import { spawn, spawnSync, type ChildProcessWithoutNullStreams } from 'node:child_process';

interface ProcessManagerOptions {
  shell: string;
  maxOutputBytes: number;
}

interface Job {
  id: number;
  child: ChildProcessWithoutNullStreams;
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

function shellInvocation(shell: string, command: string): string[] {
  const name = shell.toLowerCase().replace(/\\/g, '/').split('/').at(-1) ?? shell.toLowerCase();
  return name.startsWith('powershell') || name.startsWith('pwsh') ? ['-NoProfile', '-Command', command] : ['-c', command];
}

function commandEnvironment(): NodeJS.ProcessEnv {
  const comspec = process.env.ComSpec ?? process.env.COMSPEC ?? 'C:\\Windows\\System32\\cmd.exe';
  return { ...process.env, ComSpec: comspec, COMSPEC: comspec };
}

export class ProcessManager {
  private readonly jobs = new Map<number, Job>();
  constructor(private readonly options: ProcessManagerOptions) {}

  async run(command: string, cwd: string, timeoutMs: number): Promise<RunResult> {
    return await new Promise((resolve) => {
      const child = spawn(this.options.shell, shellInvocation(this.options.shell, command), {
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
      child.on('close', (code) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve({ exitCode: code, stdout, stderr, timedOut });
      });
    });
  }

  start(command: string, cwd: string): { processId: number } {
    const child = spawn(this.options.shell, shellInvocation(this.options.shell, command), {
      cwd,
      env: commandEnvironment(),
      windowsHide: true,
    });
    if (!child.pid) throw new Error('Failed to start process.');
    const job: Job = {
      id: child.pid,
      child,
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
    };
    child.stdout.on('data', (data: Buffer) => add('', data));
    child.stderr.on('data', (data: Buffer) => add('[stderr] ', data));
    child.on('close', (code) => {
      job.exitCode = code;
      if (job.status === 'running') job.status = 'exited';
    });
    this.jobs.set(job.id, job);
    return { processId: job.id };
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
    this.killTree(processId);
    return true;
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
