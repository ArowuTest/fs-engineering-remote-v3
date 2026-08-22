import test from 'node:test';
import assert from 'node:assert/strict';
import { validateConfig } from '../src/config.js';
import { RuntimeDiagnostics, type RuntimeProbe } from '../src/diagnostics.js';

const config = validateConfig({
  endpointSecret: 'diagnostic-mcp-'.padEnd(48, 'm'),
  actionsSecret: 'diagnostic-actions-'.padEnd(48, 'a'),
  roots: [],
  port: 8765,
});

function probe(states: Partial<Record<keyof RuntimeProbe, boolean>>): RuntimeProbe {
  return {
    localHealth: async () => states.localHealth ?? true,
    cloudflaredRunning: async () => states.cloudflaredRunning ?? true,
    externalHealth: async () => states.externalHealth ?? true,
    openApiAvailable: async () => states.openApiAvailable ?? true,
    actionsAuthAvailable: async () => states.actionsAuthAvailable ?? true,
  };
}

test('diagnostics classify an unavailable local server without guessing tunnel state', async () => {
  const result = await new RuntimeDiagnostics(config, probe({ localHealth: false })).diagnose();
  assert.equal(result.server, 'down');
  assert.equal(result.tunnel, 'unknown');
  assert.equal(result.summary, 'FS Remote server is not running. Tunnel status cannot be evaluated.');
});

test('diagnostics classify a healthy server with unavailable tunnel connector', async () => {
  const result = await new RuntimeDiagnostics(config, probe({ cloudflaredRunning: false })).diagnose();
  assert.equal(result.server, 'healthy');
  assert.equal(result.cloudflared, 'down');
  assert.equal(result.tunnel, 'down');
  assert.equal(result.summary, 'Local FS Remote is healthy. Cloudflare tunnel connector is unavailable.');
});

test('diagnostics classify an unavailable external upstream as tunnel unavailable', async () => {
  const result = await new RuntimeDiagnostics(config, probe({ externalHealth: false })).diagnose();
  assert.equal(result.cloudflared, 'running');
  assert.equal(result.external_endpoint, 'unavailable');
  assert.equal(result.tunnel, 'down');
  assert.equal(result.summary, 'Local FS Remote is healthy. Cloudflare tunnel connector is unavailable.');
});

test('diagnostics distinguish healthy transport from API/authentication failure', async () => {
  const result = await new RuntimeDiagnostics(config, probe({ actionsAuthAvailable: false })).diagnose();
  assert.equal(result.tunnel, 'connected');
  assert.equal(result.openapi, 'available');
  assert.equal(result.actions_auth, 'unavailable');
  assert.equal(result.summary, 'Transport is available but API/authentication layer requires investigation.');
});

test('diagnostics report the healthy full runtime chain', async () => {
  const result = await new RuntimeDiagnostics(config, probe({})).diagnose();
  assert.equal(result.agent, 'FS Engineering Remote v2');
  assert.equal(result.version, '2.0.0-dev');
  assert.equal(result.environment, 'validation / development');
  assert.equal(result.endpoint, 'https://fs.fs-mcp.com');
  assert.equal(result.server, 'healthy');
  assert.equal(result.server_process, 'running');
  assert.equal(result.health_endpoint, '/healthz');
  assert.equal(result.port, 8765);
  assert.equal(result.cloudflared, 'running');
  assert.equal(result.tunnel, 'connected');
  assert.equal(result.external_endpoint, 'healthy');
  assert.equal(result.openapi, 'available');
  assert.equal(result.actions_auth, 'available');
  assert.equal(result.summary, 'FS Remote runtime chain is healthy.');
});
