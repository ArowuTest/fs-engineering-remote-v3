import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import fs from 'node:fs/promises';
import path from 'node:path';
import { ProcessManager } from '../src/processes.js';

const manager = new ProcessManager({
  shell: process.platform === 'win32' ? 'powershell.exe' : '/bin/sh',
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
    process.platform === 'win32' ? "Write-Output 'FS_REMOTE_OK'" : "printf 'FS_REMOTE_OK\n'",
    os.tmpdir(),
    10_000,
  );
  assert.equal(result.exitCode, 0);
  assert.match(result.stdout, /FS_REMOTE_OK/);
  assert.equal(result.timedOut, false);
  assert.ok(result.spawnLatencyMs >= 0);
  assert.ok(result.executionMs >= 0);
  assert.ok(result.durationMs >= result.spawnLatencyMs);
  assert.ok(Math.abs(result.durationMs - (result.spawnLatencyMs + result.executionMs)) < 5);
});
test('start and read preserve output until the job exits', async () => {
  const { processId } = manager.start(
    process.platform === 'win32' ? "Start-Sleep -Milliseconds 250; Write-Output 'ASYNC_OK'" : "sleep 0.25; printf 'ASYNC_OK\n'",
    os.tmpdir(),
  );
  const state = await waitForExit(processId);
  assert.equal(state.status, 'exited');
  assert.match(state.output, /ASYNC_OK/);
  assert.equal(state.exitCode, 0);
});

test('stop terminates a long-running job', async () => {
  const { processId } = manager.start(
    process.platform === 'win32' ? 'Start-Sleep -Seconds 30' : 'sleep 30',
    os.tmpdir(),
  );
  const stopped = manager.stop(processId);
  assert.equal(stopped, true);
  const state = await waitForExit(processId);
  assert.match(state.status, /^(exited|killed)$/);
});

test('run times out and reports the timeout', async () => {
  const result = await manager.run(
    process.platform === 'win32' ? 'Start-Sleep -Seconds 5' : 'sleep 5',
    os.tmpdir(),
    150,
  );
  assert.equal(result.timedOut, true);
});


test('repository commands do not inherit host secrets but retain ordinary build variables', async () => {
  const saved={OPENAI_API_KEY:process.env.OPENAI_API_KEY,DATABASE_URL:process.env.DATABASE_URL,GITHUB_TOKEN:process.env.GITHUB_TOKEN,SSH_AUTH_SOCK:process.env.SSH_AUTH_SOCK,SAFE_BUILD_FLAG:process.env.SAFE_BUILD_FLAG};
  process.env.OPENAI_API_KEY='SECRET_OPENAI_MARKER';
  process.env.DATABASE_URL='SECRET_DB_MARKER';
  process.env.GITHUB_TOKEN='SECRET_GH_MARKER';
  process.env.SSH_AUTH_SOCK='SECRET_SSH_AGENT_MARKER';
  process.env.SAFE_BUILD_FLAG='VISIBLE_BUILD_MARKER';
  try{
    const command=process.platform==='win32'
      ? 'Write-Output "$env:OPENAI_API_KEY|$env:DATABASE_URL|$env:GITHUB_TOKEN|$env:SSH_AUTH_SOCK|$env:SAFE_BUILD_FLAG"'
      : 'printf "%s|%s|%s|%s|%s\\n" "$OPENAI_API_KEY" "$DATABASE_URL" "$GITHUB_TOKEN" "$SSH_AUTH_SOCK" "$SAFE_BUILD_FLAG"';
    const result=await manager.run(command,os.tmpdir(),10_000);
    assert.equal(result.exitCode,0,result.stderr);
    assert.match(result.stdout,/\|\|\|\|VISIBLE_BUILD_MARKER/);
    for(const marker of ['SECRET_OPENAI_MARKER','SECRET_DB_MARKER','SECRET_GH_MARKER','SECRET_SSH_AGENT_MARKER'])assert.doesNotMatch(result.stdout,new RegExp(marker));
  }finally{
    for(const [name,value] of Object.entries(saved)){if(value===undefined)delete process.env[name];else process.env[name]=value;}
  }
});

test('long-running repository commands use the same sanitized environment', async () => {
  const prior=process.env.FS_PROVIDER_SECRET_KEY;process.env.FS_PROVIDER_SECRET_KEY='SECRET_PROVIDER_KEY_MARKER';
  try{
    const command=process.platform==='win32'
      ? 'Write-Output "<$env:FS_PROVIDER_SECRET_KEY>"'
      : 'printf "<%s>\\n" "$FS_PROVIDER_SECRET_KEY"';
    const {processId}=manager.start(command,os.tmpdir());
    const state=await waitForExit(processId);
    assert.equal(state.exitCode,0);
    assert.match(state.output,/<>/);
    assert.doesNotMatch(state.output,/SECRET_PROVIDER_KEY_MARKER/);
  }finally{if(prior===undefined)delete process.env.FS_PROVIDER_SECRET_KEY;else process.env.FS_PROVIDER_SECRET_KEY=prior;}
});


test('process session metadata redacts command-line secret material', async () => {
  const stateDir=await fs.mkdtemp(path.join(os.tmpdir(),'fs-proc-redact-'));
  const local=new ProcessManager({shell:process.platform==='win32'?'powershell.exe':'/bin/sh',maxOutputBytes:100000,stateDir});
  const marker='SECRET_COMMAND_LINE_MARKER';
  const command=process.platform==='win32'
    ? `Write-Output 'META_OK'; # --token ${marker}`
    : `printf 'META_OK\\n' # --token ${marker}`;
  try{
    const {processId,sessionId}=local.start(command,os.tmpdir());
    const deadline=Date.now()+5000;let state:any;
    while(Date.now()<deadline){state=local.read(processId,0);if(state.status!=='running')break;await new Promise(r=>setTimeout(r,50));}
    assert.equal(state.exitCode,0);
    const listed=JSON.stringify(local.listSessions());
    const read=JSON.stringify(local.readSession(sessionId,0,100));
    assert.doesNotMatch(state.command,new RegExp(marker));
    assert.doesNotMatch(listed,new RegExp(marker));
    assert.doesNotMatch(read,new RegExp(marker));
    assert.match(state.command,/\[REDACTED\]/);
  }finally{await fs.rm(stateDir,{recursive:true,force:true,maxRetries:8,retryDelay:100})}
});
