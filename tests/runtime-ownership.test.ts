import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { acquireRuntimeOwnership } from '../src/runtime-ownership.js';

test('runtime ownership writes and removes a lease around an available port', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'fs-runtime-owner-'));
  const lease = await acquireRuntimeOwnership({ host: '127.0.0.1', port: 0, repoRoot: dir, runtimeDir: dir });
  const saved = JSON.parse(await fs.readFile(path.join(dir, 'runtime-ownership.json'), 'utf8'));
  assert.equal(saved.pid, process.pid);
  assert.equal(saved.service, 'fs-engineering-remote-v3');
  await lease.release();
  await assert.rejects(fs.access(path.join(dir, 'runtime-ownership.json')));
});

test('runtime ownership refuses an already occupied port with a clear conflict', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'fs-runtime-owner-'));
  const server = net.createServer();
  await new Promise<void>((resolve, reject) => server.listen(0, '127.0.0.1', resolve).once('error', reject));
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  await assert.rejects(
    acquireRuntimeOwnership({ host: '127.0.0.1', port: address.port, repoRoot: dir, runtimeDir: dir }),
    /Runtime ownership conflict: .*already in use.*Refusing to start/,
  );
  await new Promise<void>((resolve, reject) => server.close((e) => e ? reject(e) : resolve()));
});
