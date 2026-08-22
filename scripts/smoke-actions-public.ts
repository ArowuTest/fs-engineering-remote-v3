import { loadConfig } from '../src/config.js';

const baseUrl = process.argv[2]?.replace(/\/$/, '');
if (!baseUrl) {
  console.error('Usage: npx tsx scripts/smoke-actions-public.ts https://your-domain.example');
  process.exit(2);
}

const config = loadConfig();
const headers = {
  authorization: `Bearer ${config.actionsSecret}`,
  'content-type': 'application/json',
};

async function jsonRequest(path: string, init?: RequestInit) {
  const response = await fetch(`${baseUrl}${path}`, init);
  const text = await response.text();
  let body: unknown;
  try { body = JSON.parse(text); } catch { body = text; }
  return { response, body, text };
}

const schema = await jsonRequest('/openapi.json');
if (!schema.response.ok || !/runCommand/.test(schema.text)) {
  throw new Error(`OPENAPI_BAD status=${schema.response.status}`);
}
if (schema.text.includes(config.actionsSecret) || schema.text.includes(config.endpointSecret)) {
  throw new Error('OPENAPI_SECRET_LEAK');
}
console.log('OPENAPI_OK');
const unauthorized = await jsonRequest('/actions/health');
if (unauthorized.response.status !== 401) {
  throw new Error(`AUTH_CHECK_BAD status=${unauthorized.response.status}`);
}
console.log('AUTH_REJECT_OK');

const health = await jsonRequest('/actions/health', { headers });
if (!health.response.ok || !(health.body as { ok?: boolean }).ok) {
  throw new Error(`ACTIONS_HEALTH_BAD status=${health.response.status}`);
}
console.log('ACTIONS_HEALTH_OK');

const rootsResult = await jsonRequest('/actions/roots', { headers });
if (!rootsResult.response.ok || !Array.isArray(rootsResult.body) || rootsResult.body.length === 0) {
  throw new Error(`ROOTS_BAD status=${rootsResult.response.status}`);
}
const roots = rootsResult.body as Array<{ name: string }>;
const root = roots.find((item) => item.name === 'fs-remote-mcp')?.name ?? roots[0].name;
console.log(`ROOTS_OK count=${roots.length}`);

const command = await jsonRequest('/actions/run-command', {
  method: 'POST', headers,
  body: JSON.stringify({ root, cwd: '.', command: "Write-Output 'ACTIONS_PUBLIC_OK'" }),
});
if (!command.response.ok || !/ACTIONS_PUBLIC_OK/.test(command.text)) {
  throw new Error(`COMMAND_BAD status=${command.response.status}`);
}
console.log('COMMAND_OK');
const blocked = await jsonRequest('/actions/run-command', {
  method: 'POST', headers,
  body: JSON.stringify({ root, cwd: '.', command: 'git push origin main' }),
});
if (blocked.response.status !== 400 || !/git push is disabled by policy/i.test(blocked.text)) {
  throw new Error(`GIT_PUSH_CHECK_BAD status=${blocked.response.status}`);
}
console.log('GIT_PUSH_BLOCKED');