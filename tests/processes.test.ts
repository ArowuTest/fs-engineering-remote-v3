import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import { ProcessManager } from '../src/processes.js';

const manager = new ProcessManager({
  shell: 'powershell.exe',
  maxOutputBytes: 100_000,
});

async function waitForExit(processId: number, timeoutMs = 5_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const state = manager.read(processId, 0);
    if (state.status !== 'running') return state;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`Process ${processId} did not exit within ${timeoutMs}ms`);
}

test('run captures stdout and exit code', async () => {
  const result = await manager.run(
    "Write-Output 'FS_REMOTE_OK'",
    os.tmpdir(),
    10_000,
  );
  assert.equal(result.exitCode, 0);
  assert.match(result.stdout, /FS_REMOTE_OK/);
  assert.equal(result.timedOut, false);
});
test('start and read preserve output until the job exits', async () => {
  const { processId } = manager.start(
    "Start-Sleep -Milliseconds 250; Write-Output 'ASYNC_OK'",
    os.tmpdir(),
  );
  const state = await waitForExit(processId);
  assert.equal(state.status, 'exited');
  assert.match(state.output, /ASYNC_OK/);
  assert.equal(state.exitCode, 0);
});

test('stop terminates a long-running job', async () => {
  const { processId } = manager.start(
    'Start-Sleep -Seconds 30',
    os.tmpdir(),
  );
  const stopped = manager.stop(processId);
  assert.equal(stopped, true);
  const state = await waitForExit(processId);
  assert.match(state.status, /^(exited|killed)$/);
});

test('run times out and reports the timeout', async () => {
  const result = await manager.run(
    'Start-Sleep -Seconds 5',
    os.tmpdir(),
    150,
  );
  assert.equal(result.timedOut, true);
});
