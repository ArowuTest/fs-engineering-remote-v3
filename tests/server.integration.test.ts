import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { buildHttpApp } from '../src/http.js';
import { validateConfig } from '../src/config.js';

test('MCP endpoint lists tools and can read a file inside a configured root', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'fs-remote-mcp-'));
  await fs.writeFile(path.join(dir, 'hello.txt'), 'hello from MCP', 'utf8');
  const config = validateConfig({
    endpointSecret: 'integration-secret-'.padEnd(48, 'x'),
    actionsSecret: 'integration-actions-'.padEnd(48, 'y'),
    roots: [{ name: 'fixture', path: dir }],
  });
  const app = buildHttpApp(config);
  const address = await app.listen({ host: '127.0.0.1', port: 0 });
  const endpoint = new URL(`/mcp/${config.endpointSecret}`, address);
  const client = new Client({ name: 'integration-test', version: '1.0.0' });
  await client.connect(new StreamableHTTPClientTransport(endpoint));
  const listed = await client.listTools();
  assert.ok(listed.tools.some((tool) => tool.name === 'read_file'));
  assert.ok(listed.tools.some((tool) => tool.name === 'run_command'));
  const result = await client.callTool({
    name: 'read_file',
    arguments: { root: 'fixture', path: 'hello.txt' },
  });
  assert.match(JSON.stringify(result), /hello from MCP/);
  await client.close();
  await app.close();
});
test('MCP endpoint exposes capability discovery and bundled skill tools', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'fs-remote-mcp-skills-'));
  const config = validateConfig({
    endpointSecret: 'skills-secret-'.padEnd(48, 'x'),
    actionsSecret: 'skills-actions-'.padEnd(48, 'y'),
    roots: [{ name: 'fixture', path: dir }],
  });
  const app = buildHttpApp(config);
  const address = await app.listen({ host: '127.0.0.1', port: 0 });
  const endpoint = new URL(`/mcp/${config.endpointSecret}`, address);
  const client = new Client({ name: 'skills-integration-test', version: '1.0.0' });
  await client.connect(new StreamableHTTPClientTransport(endpoint));
  const listed = await client.listTools();
  for (const name of ['capabilities', 'diagnose_runtime', 'agent_bootstrap', 'list_skills', 'read_skill', 'list_skill_resources', 'read_skill_resource']) {
    assert.ok(listed.tools.some((tool) => tool.name === name), `missing MCP tool ${name}`);
  }
  const capabilities = await client.callTool({ name: 'capabilities', arguments: {} });
  assert.match(JSON.stringify(capabilities), /run_command/);
  assert.match(JSON.stringify(capabilities), /343/);
  assert.match(JSON.stringify(capabilities), /flutter/);
  const skills = await client.callTool({
    name: 'list_skills',
    arguments: { query: 'deep research', source: 'core', limit: 20 },
  });
  assert.match(JSON.stringify(skills), /core:deep-research/);
  const skill = await client.callTool({
    name: 'read_skill',
    arguments: { id: 'core:deep-research' },
  });
  assert.match(JSON.stringify(skill), /# Deep Research/);
  const resources = await client.callTool({
    name: 'list_skill_resources',
    arguments: { id: 'core:agent-self-evaluation' },
  });
  assert.match(JSON.stringify(resources), /references\/evaluation-criteria\.md/);
  const resource = await client.callTool({
    name: 'read_skill_resource',
    arguments: { id: 'core:agent-self-evaluation', path: 'references/evaluation-criteria.md' },
  });
  assert.match(JSON.stringify(resource), /evaluation/i);
  await client.close();
  await app.close();
});
