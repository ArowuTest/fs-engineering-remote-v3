import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import Fastify from 'fastify';
import { db } from '../src/db.js';
import { buildHttpApp } from '../src/http.js';
import { validateConfig } from '../src/config.js';
import { registerUserPlatformRoutes } from '../src/user-platform-http.js';
import { createRemoteOperations } from '../src/operations.js';
import { ProcessManager } from '../src/processes.js';

const fixtureConfig = (roots: any[] = []) => validateConfig({endpointSecret: 'e'.repeat(48), actionsSecret: 'a'.repeat(48), roots});
async function mockDatabase<T>(run: () => Promise<T>, responder: (sql: string, values: any[]) => any) {
  const prior = process.env.DATABASE_URL; process.env.DATABASE_URL = 'postgresql://fixture:fixture@127.0.0.1:1/never_connect';
  const pool: any = db(), query = pool.query, connect = pool.connect;
  pool.query = async (sql: string, values: any[] = []) => responder(String(sql), values);
  pool.connect = async () => ({query: pool.query, release() {}});
  try { return await run(); } finally { pool.query = query; pool.connect = connect; if (prior === undefined) delete process.env.DATABASE_URL; else process.env.DATABASE_URL = prior; }
}

test('R04: token enrollment returns the credential consumed by existing node agents', async () => {
  await mockDatabase(async () => {
    const app = Fastify(); registerUserPlatformRoutes(app);
    try {
      const response = await app.inject({method: 'POST', url: '/api/nodes/enrollment/consume', payload: {token: 'fixture-only', nodeId: 'fixture-node'}});
      assert.equal(response.statusCode, 201);
      const body = response.json();
      assert.equal(typeof body.secret, 'string');
      assert.equal(body.secret, body.nodeSecret, 'compatibility alias must identify the same single issued credential');
      assert.ok(body.secret.length >= 32);
    } finally { await app.close(); }
  }, sql => sql.startsWith('SELECT * FROM node_enrollments') ? {rowCount: 1, rows: [{id: 'fixture-enrollment', workspace_id: 'workspace-a', user_id: 'fixture-owner', name: 'fixture', platform: 'win32', capabilities: ['filesystem'], projects: []}]} : {rowCount: 1, rows: [{id: 'fixture-node'}]});
});

test('R05: same-origin OAuth form submission reaches its handler', async () => {
  const app = buildHttpApp(fixtureConfig());
  try {
    const response = await app.inject({method: 'POST', url: '/oauth/authorize', headers: {origin: 'http://control-plane.example', host: 'control-plane.example'}, payload: {}});
    assert.notEqual(response.json().error, 'Browser-origin requests are not accepted.');
    assert.equal(response.statusCode, 400, 'invalid client must be rejected by OAuth, not the Origin guard');
  } finally { await app.close(); }
});

test('R05: a hostile origin is rejected on browser API and OAuth paths', async () => {
  const app = buildHttpApp(fixtureConfig());
  try {
    for (const url of ['/api/auth/login', '/oauth/authorize']) {
      const response = await app.inject({method: 'POST', url, headers: {origin: 'https://hostile.example', host: 'control-plane.example'}, payload: {}});
      assert.equal(response.statusCode, 403, url);
    }
  } finally { await app.close(); }
});

test('R06: viewer/read-only OAuth cannot mutate a filesystem root', async () => {
  await mockDatabase(async () => {
    const base = await fs.mkdtemp(path.join(os.tmpdir(), 'fs-review-auth-'));
    const app = buildHttpApp(fixtureConfig([{name: 'fixture', path: base, workspaceId: 'workspace-a'}]));
    try {
      const response = await app.inject({method: 'POST', url: '/actions/fs', headers: {authorization: 'Bearer fixture-viewer'}, payload: {action: 'write', root: 'fixture', path: 'marker.txt', content: 'fixture only'}});
      assert.equal(response.statusCode, 403);
      await assert.rejects(() => fs.access(path.join(base, 'marker.txt')));
    } finally { await app.close(); await fs.rm(base, {recursive: true, force: true}); }
  }, () => ({rowCount: 1, rows: [{user_id: 'viewer-a', workspace_id: 'workspace-a', username: 'viewer', role: 'viewer', scopes: ['fs.read']}]}));
});

test('R06: a downgraded viewer cannot keep mutation authority through an older fs.write token', async () => {
  await mockDatabase(async () => {
    const base = await fs.mkdtemp(path.join(os.tmpdir(), 'fs-review-downgrade-'));
    const app = buildHttpApp(fixtureConfig([{name: 'fixture', path: base, workspaceId: 'workspace-a'}]));
    try {
      const response = await app.inject({method: 'POST', url: '/actions/fs', headers: {authorization: 'Bearer fixture-old-token'}, payload: {action: 'write', root: 'fixture', path: 'marker.txt', content: 'fixture only'}});
      assert.equal(response.statusCode, 403);
      await assert.rejects(() => fs.access(path.join(base, 'marker.txt')));
    } finally { await app.close(); await fs.rm(base, {recursive: true, force: true}); }
  }, () => ({rowCount: 1, rows: [{user_id: 'viewer-a', workspace_id: 'workspace-a', username: 'viewer', role: 'viewer', scopes: ['fs.read', 'fs.write']}]}));
});

test('R06: a workspace may not enumerate or use another workspace root', async () => {
  await mockDatabase(async () => {
    const base = await fs.mkdtemp(path.join(os.tmpdir(), 'fs-review-root-owner-'));
    const app = buildHttpApp(fixtureConfig([{name: 'private-b', path: base, workspaceId: 'workspace-b'}]));
    try {
      const response = await app.inject({method: 'POST', url: '/actions/fs', headers: {authorization: 'Bearer fixture-engineer'}, payload: {action: 'roots'}});
      assert.doesNotMatch(response.body, /private-b/);
      const write = await app.inject({method: 'POST', url: '/actions/fs', headers: {authorization: 'Bearer fixture-engineer'}, payload: {action: 'write', root: 'private-b', path: 'marker.txt', content: 'fixture only'}});
      assert.notEqual(write.statusCode, 200);
    } finally { await app.close(); await fs.rm(base, {recursive: true, force: true}); }
  }, () => ({rowCount: 1, rows: [{user_id: 'engineer-a', workspace_id: 'workspace-a', username: 'engineer', role: 'engineer', scopes: ['fs.read', 'fs.write']}]}));
});

test('R09: file reads and writes cannot follow an in-root link to an outside directory', async () => {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), 'fs-review-link-'));
  const allowed = path.join(base, 'allowed'), outside = path.join(base, 'outside'), link = path.join(allowed, 'link');
  await fs.mkdir(allowed); await fs.mkdir(outside); await fs.writeFile(path.join(outside, 'marker.txt'), 'outside fixture');
  await fs.symlink(outside, link, process.platform === 'win32' ? 'junction' : 'dir');
  try {
    const config = fixtureConfig([{name: 'fixture', path: allowed}]);
    const ops = createRemoteOperations(config, new ProcessManager({shell: config.shell, maxOutputBytes: config.maxOutputBytes}));
    await assert.rejects(() => ops.readFile('fixture', 'link/marker.txt'), /root|link|reparse/i);
    await assert.rejects(() => ops.writeFile('fixture', 'link/new.txt', 'never write this', 'rewrite'), /root|link|reparse/i);
    await assert.rejects(() => fs.access(path.join(outside, 'new.txt')));
  } finally { await fs.unlink(link); await fs.rm(base, {recursive: true, force: true}); }
});
