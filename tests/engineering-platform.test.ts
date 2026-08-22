import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { ProcessManager } from '../src/processes.js';
import { RemoteOperations } from '../src/operations.js';
import { validateConfig } from '../src/config.js';

async function fixture() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'fs-platform-'));
  const pm = new ProcessManager({ shell: 'powershell.exe', maxOutputBytes: 1024 * 1024 });
  const config = validateConfig({ endpointSecret: 'm'.repeat(48), actionsSecret: 'a'.repeat(48), roots: [{ name: 'work', path: dir }] });
  return { dir, pm, ops: new RemoteOperations(config, pm) };
}

async function initRepo(dir: string) {
  const { spawnSync } = await import('node:child_process');
  for (const args of [['init'], ['config','user.email','test@example.invalid'], ['config','user.name','Test']]) {
    const r=spawnSync('git', args, { cwd: dir }); assert.equal(r.status, 0);
  }
  await fs.writeFile(path.join(dir,'package.json'), JSON.stringify({ scripts: { test: 'node --test', build: 'tsc' } }));
  spawnSync('git',['add','-A'],{cwd:dir}); spawnSync('git',['commit','-m','initial'],{cwd:dir});
}

test('repository inspection returns branch, head and project tooling', async () => {
  const { dir, ops } = await fixture(); await initRepo(dir);
  const result = await ops.inspectRepository('work','.');
  assert.ok(result.branch); assert.match(result.head,/^[a-f0-9]{40}$/); assert.equal(result.dirty,false);
  assert.equal(result.detected.packageScripts.test,'node --test');
});

test('persistent memory and checkpoints survive calls and detect repository divergence', async () => {
  const { dir, ops } = await fixture(); await initRepo(dir);
  await ops.writeAgentMemory('work','.','decisions.md','Use TDD.');
  assert.equal((await ops.readAgentMemory('work','.','decisions.md')).content,'Use TDD.');
  const saved = await ops.saveCheckpoint('work','.',{ task:'hardening', status:'in_progress' });
  assert.equal(saved.task,'hardening');
  let loaded = await ops.loadCheckpoint('work','.'); assert.equal(loaded.diverged,false);
  await fs.writeFile(path.join(dir,'next.txt'),'next');
  const { spawnSync } = await import('node:child_process'); spawnSync('git',['add','next.txt'],{cwd:dir}); spawnSync('git',['commit','-m','next'],{cwd:dir});
  loaded = await ops.loadCheckpoint('work','.'); assert.equal(loaded.diverged,true);
  const events=await ops.readAgentMemory('work','.','events.jsonl'); assert.match(events.content,/CHECKPOINT_SAVED/);
});

test('memory names cannot escape the governed .agent directory', async () => {
  const { ops } = await fixture();
  await assert.rejects(() => ops.writeAgentMemory('work','.','../escape.txt','x'), /simple file name/i);
});

test('long-running process output includes supervision metadata', async () => {
  const { dir, pm } = await fixture();
  const started=pm.start("Write-Output 'hello'; Start-Sleep -Seconds 5",dir);
  await new Promise(r=>setTimeout(r,400));
  const state=pm.read(started.processId,0);
  assert.equal(state.processId,started.processId); assert.equal(state.alive,true); assert.ok(state.startedAt); assert.ok(state.lastActivityAt); assert.match(state.command,/hello/);
  assert.equal(pm.stop(started.processId),true);
});

test('governed Git push works against a disposable local bare remote', async () => {
  const { dir, ops } = await fixture(); await initRepo(dir);
  const remote=await fs.mkdtemp(path.join(os.tmpdir(),'fs-remote-bare-'));
  const { spawnSync }=await import('node:child_process'); spawnSync('git',['init','--bare',remote],{cwd:dir}); spawnSync('git',['remote','add','origin',remote],{cwd:dir});
  const branch=(await ops.inspectRepository('work','.')).branch;
  const result=await ops.gitPush('work','.','origin',branch,true,false);
  assert.equal(result.exitCode,0); assert.match(result.stderr+result.stdout,/new branch|set up to track/i);
});
