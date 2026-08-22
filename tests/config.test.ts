import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadConfig, validateConfig } from '../src/config.js';

const endpointSecret = 'e'.repeat(48);
const actionsSecret = 'a'.repeat(48);

test('validateConfig normalizes roots and applies safe defaults', () => {
  const config = validateConfig({
    endpointSecret,
    actionsSecret,
    roots: [{ name: 'repo', path: './fixtures/repo' }],
  });
  assert.equal(config.host, '127.0.0.1');
  assert.equal(config.port, 8765);
  assert.equal(config.commandTimeoutMs, 120000);
  assert.equal(config.maxOutputBytes, 2_000_000);
  assert.equal(config.actionsSecret, actionsSecret);
  assert.equal(config.roots[0].path, path.resolve('./fixtures/repo'));
});

test('validateConfig rejects weak endpoint secrets', () => {
  assert.throws(
    () => validateConfig({ endpointSecret: 'short', actionsSecret, roots: [] }),
    /endpointSecret.*32/i,
  );
});
test('validateConfig rejects weak actions secrets', () => {
  assert.throws(
    () => validateConfig({ endpointSecret, actionsSecret: 'short', roots: [] }),
    /actionsSecret.*32/i,
  );
});

test('validateConfig requires Actions and MCP secrets to differ', () => {
  assert.throws(
    () => validateConfig({ endpointSecret, actionsSecret: endpointSecret, roots: [] }),
    /actionsSecret.*differ/i,
  );
});

test('validateConfig rejects duplicate root names', () => {
  assert.throws(() => validateConfig({
    endpointSecret,
    actionsSecret,
    roots: [{ name: 'repo', path: 'C:/one' }, { name: 'repo', path: 'C:/two' }],
  }), /duplicate root/i);
});

test('loadConfig accepts UTF-8 JSON with a Windows PowerShell BOM', () => {
  const file = path.join(os.tmpdir(), `fs-remote-config-${Date.now()}.json`);
  const json = JSON.stringify({ endpointSecret, actionsSecret, roots: [] });
  fs.writeFileSync(file, `\uFEFF${json}`, 'utf8');
  const config = loadConfig(file);
  assert.equal(config.endpointSecret.length, 48);
  assert.equal(config.actionsSecret.length, 48);
  fs.unlinkSync(file);
});