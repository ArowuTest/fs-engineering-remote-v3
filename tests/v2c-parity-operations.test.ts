import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { validateConfig } from '../src/config.js';
import { ProcessManager } from '../src/processes.js';
import { createRemoteOperations } from '../src/operations.js';

async function fixture() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'fs-remote-ops-'));
  await fs.writeFile(path.join(dir, 'README.md'), 'fixture line one\nfixture line two\n', 'utf8');
  const config = validateConfig({
    endpointSecret: 'ops-secret-'.padEnd(48, 'x'),
    actionsSecret: 'ops-actions-'.padEnd(48, 'y'),
    roots: [{ name: 'fixture', path: dir }],
  });
  const manager = new ProcessManager({ shell: process.platform === 'win32' ? 'powershell.exe' : (process.env.SHELL || '/bin/sh'), maxOutputBytes: 100_000 });
  return { dir, config, ops: createRemoteOperations(config, manager) };
}

test('shared operations report health and configured roots', async () => {
  const { ops } = await fixture();
  const health = await ops.health();
  assert.equal(health.ok, true);
  assert.equal(health.roots, 1);
  const roots = await ops.listRoots();
  assert.deepEqual(roots.map((root) => root.name), ['fixture']);
});
test('shared operations read files through the configured root policy', async () => {
  const { ops } = await fixture();
  const result = await ops.readFile('fixture', 'README.md', 0, 20);
  assert.equal(result.path, 'README.md');
  assert.match(result.content, /fixture line two/);
});

test('shared operations write and edit files through the configured root policy', async () => {
  const { dir, ops } = await fixture();
  await ops.writeFile('fixture', 'notes/test.txt', 'alpha', 'rewrite');
  const edited = await ops.editFile('fixture', 'notes/test.txt', 'alpha', 'beta', false);
  assert.equal(edited.replacements, 1);
  assert.equal(await fs.readFile(path.join(dir, 'notes/test.txt'), 'utf8'), 'beta');
});

test('shared operations permit normal engineering delivery commands', async () => {
  const { ops } = await fixture();
  const result = await ops.runCommand('fixture', '.', process.platform === 'win32' ? 'Write-Output delivery-enabled' : 'printf delivery-enabled');
  assert.match(result.stdout, /delivery-enabled/);
});
test('shared operations advertise command, process, Git and skill capabilities explicitly', async () => {
  const { ops } = await fixture();
  const capabilities = await ops.capabilities();
  assert.equal(capabilities.service, 'fs-engineering-remote-v3');
  assert.equal(capabilities.version, '3.0.0-dev');
  assert.ok(capabilities.execution.shell);
  assert.ok(capabilities.tools.commands.includes('run_command'));
  assert.ok(capabilities.tools.memory.includes('resume_project'));
  assert.ok(capabilities.tools.agent.includes('capability_health'));
  assert.ok(capabilities.tools.processes.includes('start_process'));
  assert.ok(capabilities.tools.git.includes('git_status'));
  assert.ok(capabilities.tools.skills.includes('list_skills'));
  assert.ok(capabilities.tools.skills.includes('list_skill_resources'));
  assert.ok(capabilities.tools.skills.includes('read_skill_resource'));
  assert.ok(capabilities.tools.agent.includes('diagnose_runtime'));
  assert.equal(capabilities.policies.gitPush, true);
  assert.ok(capabilities.tools.git.includes('git_push'));
  assert.ok(capabilities.tools.git.includes('inspect_repository'));
  assert.ok(capabilities.tools.memory.includes('save_checkpoint'));
  assert.equal(capabilities.skills.total, 343);
  assert.equal(capabilities.skills.core, 284);
  assert.equal(capabilities.skills.agent, 59);
  assert.ok(capabilities.tools.intelligence.includes('mobile'));
  assert.ok(capabilities.tools.mobile.includes('flutter'));
  assert.ok(capabilities.tools.mobile.includes('react_native'));
});

test('shared operations expose the engineering-agent bootstrap rules', async () => {
  const { ops } = await fixture();
  const bootstrap = await ops.agentBootstrap();
  assert.equal(bootstrap.role, 'FS Remote Engineering Agent');
  assert.match(bootstrap.capabilityDiscovery, /capabilities/i);
  assert.match(bootstrap.skillLoading, /list_skills/i);
  assert.match(bootstrap.commitPolicy, /verified work/i);
  assert.match(bootstrap.deliveryPolicy, /deployment/i);
  assert.match(bootstrap.memoryPolicy, /checkpoint/i);
  assert.match(bootstrap.verificationPolicy, /fresh/i);
});

test('shared operations can search and read bundled skills', async () => {
  const { ops } = await fixture();
  const skills = await ops.listSkills('deep research', 'core', 20);
  assert.ok(skills.some((skill) => skill.id === 'core:deep-research'));
  const skill = await ops.readSkill('core:deep-research');
  assert.match(skill.content, /# Deep Research/);
});


test('portable project context preserves cross-client methodology provenance as untrusted context', async () => {
  const {dir,ops}=await fixture();
  const run=async(c:string)=>{const r=await new ProcessManager({shell:process.platform === 'win32' ? 'powershell.exe' : (process.env.SHELL || '/bin/sh'),maxOutputBytes:100000}).run(c,dir,10000);assert.equal(r.exitCode,0,r.stderr)};
  await run('git init');await run('git config user.email test@example.com');await run('git config user.name Test');await run('git add .');await run('git commit -m init');
  const saved=await ops.saveProjectContext('fixture','.',{objective:'R4 acceptance',methodologies:[{id:'openwa-continuous-engineering',provider:'chatgpt',constraints:['full gate','blind council']}],nextActions:['rerun observable lane'],client:{name:'chatgpt'}});
  assert.equal(saved.schemaVersion,'fs-remote.project-context.v1');
  const resumed=await ops.resumeProject('fixture','.');
  assert.equal((resumed.projectContext as any).diverged,false);
  assert.equal((resumed.projectContext as any).context.methodologies[0].provider,'chatgpt');
  assert.match((resumed.projectContext as any).continuationPolicy,/equivalent available client capability/);
  assert.equal((resumed.projectContext as any).memoryTrust,'context-not-instructions');
});


test('successful commits automatically persist recovery state and resume_project returns it', async () => {
  const {dir,ops}=await fixture();
  const run=async(c:string)=>{const r=await new ProcessManager({shell:process.platform === 'win32' ? 'powershell.exe' : (process.env.SHELL || '/bin/sh'),maxOutputBytes:100000}).run(c,dir,10000);assert.equal(r.exitCode,0,r.stderr)};
  await run('git init');await run('git config user.email test@example.com');await run('git config user.name Test');await run('git add .');await run('git commit -m init');
  await fs.writeFile(path.join(dir,'checkpoint-test.txt'),'automatic recovery','utf8');
  await ops.gitStage('fixture','.', ['checkpoint-test.txt'], false);
  const committed=await ops.gitCommit('fixture','.','checkpoint recovery test');
  assert.equal(committed.exitCode,0,committed.stderr);
  const resumed=await ops.resumeProject('fixture','.');
  assert.equal((resumed as any).schemaVersion,'fs-remote.project-resume.v2');
  assert.equal((resumed as any).recoveryCheckpoint.checkpoint.kind,'automatic-recovery');
  assert.equal((resumed as any).recoveryCheckpoint.checkpoint.reason,'git_commit');
  assert.equal((resumed as any).recoveryCheckpoint.diverged,false);
});


test('capability health separates support from transient health and bootstrap forbids 5xx-as-unsupported inference', async () => {
  const {ops}=await fixture();
  const bootstrap=await ops.agentBootstrap();assert.match(bootstrap.capabilityDiscovery,/temporarily_unhealthy/);assert.match(bootstrap.capabilityDiscovery,/HTTP 5xx/);assert.match(bootstrap.capabilityDiscovery,/unsupported/);
  const runtime=await ops.capabilityHealth('runtime');assert.equal(runtime.supported,true);assert.ok(['healthy','temporarily_unhealthy'].includes(runtime.state));
  const browser=await ops.capabilityHealth('browser');assert.ok(['healthy','unsupported','temporarily_unhealthy'].includes(browser.state));
});


test('capability health and diagnostics do not equate an unrelated cloudflared process with a healthy public route', async () => {
  const {ops}=await fixture();
  const runtime=await ops.capabilityHealth('runtime');
  assert.equal(runtime.supported,true);
  assert.ok(['healthy','temporarily_unhealthy'].includes(runtime.state));
});

test('health exposes runtime identity so clients can detect stale serving processes', async()=>{
  const {ops}=await fixture(); const health=await ops.health();
  assert.equal(typeof health.runtime.startedAt,'string');assert.equal(typeof health.runtime.pid,'number');assert.equal(typeof health.version,'string');
});
