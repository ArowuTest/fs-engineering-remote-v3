import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { buildHttpApp } from '../src/http.js';
import { validateConfig } from '../src/config.js';

const bearer = 'actions-integration-'.padEnd(48, 'a');

async function fixture() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'fs-remote-actions-'));
  await fs.writeFile(path.join(dir, 'hello.txt'), 'hello from Actions\n', 'utf8');
  spawnSync('git', ['init'], { cwd: dir, windowsHide: true });
  spawnSync('git', ['config', 'user.email', 'actions@example.invalid'], { cwd: dir, windowsHide: true });
  spawnSync('git', ['config', 'user.name', 'Actions Test'], { cwd: dir, windowsHide: true });
  const config = validateConfig({
    endpointSecret: 'actions-mcp-'.padEnd(48, 'm'),
    actionsSecret: bearer,
    roots: [{ name: 'fixture', path: dir }],
  });
  return { dir, config, app: buildHttpApp(config) };
}

function auth() {
  return { authorization: `Bearer ${bearer}` };
}
test('OpenAPI schema is public and never contains configured secrets', async () => {
  const { app, config } = await fixture();
  const response = await app.inject({ method: 'GET', url: '/openapi.json' });
  assert.equal(response.statusCode, 200);
  const body = response.body;
  assert.match(body, /processOperation/);
  const document = response.json() as Record<string, any>;
  const operations = Object.values(document.paths ?? {}).flatMap((path: any) => Object.values(path)).filter((op: any) => op?.operationId);
  assert.equal(operations.length, 7);
  assert.match(body, /bearerAuth/);
  assert.doesNotMatch(body, new RegExp(config.actionsSecret));
  assert.doesNotMatch(body, new RegExp(config.endpointSecret));
  await app.close();
});

test('Actions routes reject missing and incorrect bearer credentials', async () => {
  const { app } = await fixture();
  const missing = await app.inject({ method: 'GET', url: '/actions/health' });
  assert.equal(missing.statusCode, 401);
  const wrong = await app.inject({
    method: 'GET', url: '/actions/health',
    headers: { authorization: 'Bearer wrong-key' },
  });
  assert.equal(wrong.statusCode, 401);
  await app.close();
});

test('authorized Actions health and roots use the shared operations service', async () => {
  const { app } = await fixture();
  const health = await app.inject({ method: 'GET', url: '/actions/health', headers: auth() });
  assert.equal(health.statusCode, 200);
  assert.equal(health.json().ok, true);
  const roots = await app.inject({ method: 'GET', url: '/actions/roots', headers: auth() });
  assert.equal(roots.statusCode, 200);
  assert.deepEqual(roots.json().map((root: { name: string }) => root.name), ['fixture']);
  await app.close();
});
test('Actions can read, write and edit safe files inside a configured root', async () => {
  const { app, dir } = await fixture();
  const read = await app.inject({
    method: 'POST', url: '/actions/read-file', headers: auth(),
    payload: { root: 'fixture', path: 'hello.txt', offset: 0, length: 20 },
  });
  assert.equal(read.statusCode, 200);
  assert.match(read.json().content, /hello from Actions/);
  const write = await app.inject({
    method: 'POST', url: '/actions/write-file', headers: auth(),
    payload: { root: 'fixture', path: 'notes.txt', content: 'alpha', mode: 'rewrite' },
  });
  assert.equal(write.statusCode, 200);
  const edit = await app.inject({
    method: 'POST', url: '/actions/edit-file', headers: auth(),
    payload: { root: 'fixture', path: 'notes.txt', oldText: 'alpha', newText: 'beta', replaceAll: false },
  });
  assert.equal(edit.statusCode, 200);
  assert.equal(await fs.readFile(path.join(dir, 'notes.txt'), 'utf8'), 'beta');
  await app.close();
});

test('Actions can run normal engineering commands including Git delivery syntax', async () => {
  const { app } = await fixture();
  const ok = await app.inject({
    method: 'POST', url: '/actions/run-command', headers: auth(),
    payload: { root: 'fixture', cwd: '.', command: "Write-Output 'ACTIONS_OK'" },
  });
  assert.equal(ok.statusCode, 200);
  assert.match(ok.json().stdout, /ACTIONS_OK/);
  const blocked = await app.inject({
    method: 'POST', url: '/actions/run-command', headers: auth(),
    payload: { root: 'fixture', cwd: '.', command: 'git push origin main' },
  });
  assert.equal(blocked.statusCode, 200);
  assert.doesNotMatch(blocked.body, /disabled by policy/i);
  await app.close();
});
test('Actions share long-running process state across start and read calls', async () => {
  const { app } = await fixture();
  const started = await app.inject({
    method: 'POST', url: '/actions/start-process', headers: auth(),
    payload: { root: 'fixture', cwd: '.', command: "Start-Sleep -Milliseconds 250; Write-Output 'ASYNC_ACTION_OK'" },
  });
  assert.equal(started.statusCode, 200);
  const processId = started.json().processId as number;
  let state: { status: string; output: string; exitCode: number | null } | undefined;
  for (let attempt = 0; attempt < 30; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 100));
    const read = await app.inject({
      method: 'POST', url: '/actions/read-process-output', headers: auth(),
      payload: { processId, cursor: 0 },
    });
    assert.equal(read.statusCode, 200);
    state = read.json();
    if (state?.status !== 'running') break;
  }
  assert.equal(state?.status, 'exited');
  assert.equal(state?.exitCode, 0);
  assert.match(state?.output ?? '', /ASYNC_ACTION_OK/);
  await app.close();
});
test('Actions can stop a long-running process started by this service', async () => {
  const { app } = await fixture();
  const started = await app.inject({
    method: 'POST', url: '/actions/start-process', headers: auth(),
    payload: { root: 'fixture', cwd: '.', command: 'Start-Sleep -Seconds 30' },
  });
  assert.equal(started.statusCode, 200);
  const processId = started.json().processId as number;
  const stopped = await app.inject({
    method: 'POST', url: '/actions/stop-process', headers: auth(),
    payload: { processId },
  });
  assert.equal(stopped.statusCode, 200);
  assert.equal(stopped.json().stopped, true);
  await app.close();
});

test('Actions expose local Git status, stage and commit without push', async () => {
  const { app, dir } = await fixture();
  await fs.writeFile(path.join(dir, 'tracked.txt'), 'tracked\n', 'utf8');
  const status = await app.inject({
    method: 'POST', url: '/actions/git-status', headers: auth(),
    payload: { root: 'fixture', cwd: '.' },
  });
  assert.equal(status.statusCode, 200);
  assert.match(status.json().stdout, /tracked\.txt/);
  const staged = await app.inject({
    method: 'POST', url: '/actions/git-stage', headers: auth(),
    payload: { root: 'fixture', cwd: '.', paths: ['tracked.txt'], all: false },
  });
  assert.equal(staged.statusCode, 200);
  const committed = await app.inject({
    method: 'POST', url: '/actions/git-commit', headers: auth(),
    payload: { root: 'fixture', cwd: '.', message: 'test: Actions commit' },
  });
  assert.equal(committed.statusCode, 200);
  assert.equal(committed.json().exitCode, 0);
  const clean = await app.inject({
    method: 'POST', url: '/actions/git-status', headers: auth(),
    payload: { root: 'fixture', cwd: '.' },
  });
  assert.equal(clean.statusCode, 200);
  assert.doesNotMatch(clean.json().stdout, /tracked\.txt/);
  await app.close();
});
test('OpenAPI document satisfies GPT Actions object-schema requirements', async () => {
  const { app } = await fixture();
  const response = await app.inject({ method: 'GET', url: '/openapi.json' });
  assert.equal(response.statusCode, 200);
  const document = response.json() as Record<string, any>;
  assert.equal(typeof document.components?.schemas, 'object');
  assert.equal(Array.isArray(document.components?.schemas), false);

  for (const pathItem of Object.values(document.paths ?? {}) as any[]) {
    for (const operation of Object.values(pathItem) as any[]) {
      const schema = operation?.responses?.['200']?.content?.['application/json']?.schema;
      assert.ok(schema, 'Every action requires a JSON 200 response schema.');
      if (schema.type === 'object') {
        assert.equal(typeof schema.properties, 'object', 'Object response schemas require properties.');
      }
    }
  }
  await app.close();
});

test('Actions expose capability discovery, bootstrap and bundled skills behind bearer auth', async () => {
  const { app } = await fixture();
  const capabilities = await app.inject({ method: 'GET', url: '/actions/capabilities', headers: auth() });
  assert.equal(capabilities.statusCode, 200);
  assert.ok(capabilities.json().tools.commands.includes('run_command'));
  assert.ok(capabilities.json().tools.agent.includes('diagnose_runtime'));
  assert.equal(capabilities.json().skills.total, 343);
  assert.equal(capabilities.json().skills.core, 284);
  assert.equal(capabilities.json().skills.agent, 59);

  const bootstrap = await app.inject({ method: 'GET', url: '/actions/agent-bootstrap', headers: auth() });
  assert.equal(bootstrap.statusCode, 200);
  assert.match(bootstrap.json().skillLoading, /list_skills/i);

  const skills = await app.inject({
    method: 'POST', url: '/actions/list-skills', headers: auth(),
    payload: { query: 'deep research', source: 'core', limit: 20 },
  });
  assert.equal(skills.statusCode, 200);
  assert.ok(skills.json().some((skill: { id: string }) => skill.id === 'core:deep-research'));

  const skill = await app.inject({
    method: 'POST', url: '/actions/read-skill', headers: auth(),
    payload: { id: 'core:deep-research' },
  });
  assert.equal(skill.statusCode, 200);
  assert.match(skill.json().content, /# Deep Research/);

  const resources = await app.inject({
    method: 'POST', url: '/actions/list-skill-resources', headers: auth(),
    payload: { id: 'core:agent-self-evaluation' },
  });
  assert.equal(resources.statusCode, 200);
  assert.ok(resources.json().some((resource: { path: string }) => resource.path === 'references/evaluation-criteria.md'));

  const resource = await app.inject({
    method: 'POST', url: '/actions/read-skill-resource', headers: auth(),
    payload: { id: 'core:agent-self-evaluation', path: 'references/evaluation-criteria.md' },
  });
  assert.equal(resource.statusCode, 200);
  assert.match(resource.json().content, /evaluation/i);

  const unauthenticated = await app.inject({ method: 'GET', url: '/actions/capabilities' });
  assert.equal(unauthenticated.statusCode, 401);
  await app.close();
});

test('OpenAPI advertises engineering-agent discovery operations', async () => {
  const { app } = await fixture();
  const response = await app.inject({ method: 'GET', url: '/openapi.json' });
  assert.equal(response.statusCode, 200);
  const body = response.body;
  const document = response.json() as Record<string, any>;
  assert.equal(document.info?.version, '2.0.0-dev');
  assert.ok(document.components?.schemas?.CapabilitiesResult?.properties?.version);
  assert.ok(document.components?.schemas?.CapabilitiesResult?.required?.includes('version'));
  for (const operationId of ['filesystemOperation', 'processOperation', 'gitOperation', 'skillOperation', 'memoryOperation', 'engineeringOperation', 'browserOperation']) {
    assert.match(body, new RegExp(`\\"operationId\\":\\"${operationId}\\"`));
  }
  assert.doesNotMatch(body, /\"operationId\":\"gitPush\"/);
  assert.match(body, /\"push\"/);
  assert.match(body, /\"diagnose\"/);
  assert.match(body, /\"read_resource\"/);
  await app.close();
});
