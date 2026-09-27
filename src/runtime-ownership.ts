import fs from 'node:fs/promises';
import path from 'node:path';
import net from 'node:net';
import { SERVICE_NAME, SERVICE_VERSION } from './version.js';

export interface RuntimeOwnershipRecord {
  schemaVersion: 'fs.runtime.ownership.v1';
  service: string;
  version: string;
  pid: number;
  host: string;
  port: number;
  repoRoot: string;
  startedAt: string;
}

export interface RuntimeOwnershipLease {
  record: RuntimeOwnershipRecord;
  release(): Promise<void>;
}

function pidAlive(pid: number): boolean {
  try { process.kill(pid, 0); return true; } catch { return false; }
}

async function assertPortFree(host: string, port: number): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.once('error', reject);
    server.listen({ host, port, exclusive: true }, () => server.close((error) => error ? reject(error) : resolve()));
  });
}

export async function acquireRuntimeOwnership(input: { host: string; port: number; repoRoot?: string; runtimeDir?: string }): Promise<RuntimeOwnershipLease> {
  const repoRoot = path.resolve(input.repoRoot ?? process.cwd());
  const runtimeDir = path.resolve(input.runtimeDir ?? path.join(repoRoot, 'runtime'));
  const file = path.join(runtimeDir, 'runtime-ownership.json');
  await fs.mkdir(runtimeDir, { recursive: true });

  let previous: RuntimeOwnershipRecord | undefined;
  try { previous = JSON.parse(await fs.readFile(file, 'utf8')) as RuntimeOwnershipRecord; } catch {}

  try {
    await assertPortFree(input.host, input.port);
  } catch (error: any) {
    const prior = previous && previous.port === input.port
      ? ` Previous FS lease: service=${previous.service} version=${previous.version} pid=${previous.pid} alive=${pidAlive(previous.pid)} repo=${previous.repoRoot}.`
      : '';
    throw new Error(`Runtime ownership conflict: ${input.host}:${input.port} is already in use.${prior} Refusing to start ${SERVICE_NAME} from ${repoRoot}.`, { cause: error });
  }

  const record: RuntimeOwnershipRecord = {
    schemaVersion: 'fs.runtime.ownership.v1', service: SERVICE_NAME, version: SERVICE_VERSION, pid: process.pid,
    host: input.host, port: input.port, repoRoot, startedAt: new Date().toISOString(),
  };
  await fs.writeFile(file, `${JSON.stringify(record, null, 2)}\n`, 'utf8');
  let released = false;
  return {
    record,
    async release() {
      if (released) return;
      released = true;
      try {
        const current = JSON.parse(await fs.readFile(file, 'utf8')) as RuntimeOwnershipRecord;
        if (current.pid === record.pid && current.port === record.port && current.repoRoot === record.repoRoot) await fs.unlink(file);
      } catch {}
    },
  };
}
