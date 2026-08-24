import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { ProcessManager } from '../src/processes.js';
import { RemoteOperations } from '../src/operations.js';
import { validateConfig } from '../src/config.js';

async function fixture() {
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'fs-evidence-'));
  const pm=new ProcessManager({shell:process.platform === 'win32'?'powershell.exe':'/bin/sh',maxOutputBytes:1024*1024});
  const config=validateConfig({endpointSecret:'m'.repeat(48),actionsSecret:'a'.repeat(48),roots:[{name:'work',path:dir}]});
  const ops=new RemoteOperations(config,pm);
  const {spawnSync}=await import('node:child_process');
  spawnSync('git',['init'],{cwd:dir});spawnSync('git',['config','user.email','test@example.invalid'],{cwd:dir});spawnSync('git',['config','user.name','Test'],{cwd:dir});
  await fs.writeFile(path.join(dir,'package.json'),JSON.stringify({scripts:{test:'node --test',lint:'eslint .',build:'tsc'}}));
  spawnSync('git',['add','-A'],{cwd:dir});spawnSync('git',['commit','-m','initial'],{cwd:dir});
  return {dir,ops};
}

test('project readiness is deterministic and fails closed conceptually',async()=>{
  const {ops}=await fixture();const r=await ops.projectReadiness('work','.');
  assert.equal(r.schemaVersion,'fs-remote.project-readiness.v1');assert.deepEqual(r.recommendedChecks,['test','lint','build']);
  assert.match(r.principle,/fail closed/i);
});

test('engineering evidence separates observed evidence from recalled memory',async()=>{
  const {ops}=await fixture();await ops.saveCheckpoint('work','.',{task:'review'});const e=await ops.engineeringEvidence('work','.');
  assert.equal(e.schemaVersion,'fs-remote.engineering-evidence.v1');assert.ok(e.checkpoint);assert.match(e.evidencePolicy,/observed evidence/i);
});

test('loaded checkpoint labels memory as context not instructions',async()=>{
  const {ops}=await fixture();await ops.saveCheckpoint('work','.',{task:'resume'});const c=await ops.loadCheckpoint('work','.');assert.equal(c.memoryTrust,'context-not-instructions');
});

test('environment capability discovery returns structured browser and CLI inventory',async()=>{
  const {ops}=await fixture();const e=await ops.environmentCapabilities();assert.equal(e.platform,process.platform);assert.equal(typeof e.tools.git.available,'boolean');assert.ok(Array.isArray(e.browsers));assert.equal(e.browserAutomation.playwrightIntegrated,true);assert.equal(e.browserAutomation.engine,'playwright-core');
});
