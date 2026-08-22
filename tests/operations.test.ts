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
  const manager = new ProcessManager({ shell: 'powershell.exe', maxOutputBytes: 100_000 });
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
  const result = await ops.runCommand('fixture', '.', 'Write-Output delivery-enabled');
  assert.match(result.stdout, /delivery-enabled/);
});
test('shared operations advertise command, process, Git and skill capabilities explicitly', async () => {
  const { ops } = await fixture();
  const capabilities = await ops.capabilities();
  assert.equal(capabilities.service, 'fs-engineering-remote-v3');
  assert.equal(capabilities.version, '3.0.0-dev');
  assert.equal(capabilities.execution.shell, 'PowerShell');
  assert.ok(capabilities.tools.commands.includes('run_command'));
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
