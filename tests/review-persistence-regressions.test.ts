import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { db } from '../src/db.js';
import { MissionManager } from '../src/missions.js';
import { PgStateStore } from '../src/pg-state.js';
import { ExecutionRouter } from '../src/execution-router.js';
import { WorkerQueue } from '../src/workers.js';
import { MissionOrchestrator } from '../src/orchestrator.js';
import { PlanDispatcher } from '../src/plans.js';
import { contextFingerprint } from '../src/quality.js';

// Query-capture regressions supplement, rather than replace, the real PostgreSQL suite.
async function withDatabase<T>(run: (calls: Array<{sql: string; values: any[]}>, pool: any) => Promise<T>, responder: (sql: string, values: any[]) => any = () => ({rows: [], rowCount: 0})) {
  const prior = process.env.DATABASE_URL;
  process.env.DATABASE_URL = 'postgresql://fixture:fixture@127.0.0.1:1/never_connect';
  const pool: any = db(), query = pool.query, connect = pool.connect;
  const calls: Array<{sql: string; values: any[]}> = [];
  pool.query = async (sql: string, values: any[] = []) => { calls.push({sql: String(sql), values}); return responder(String(sql), values); };
  pool.connect = async () => ({query: pool.query, release() {}});
  try { return await run(calls, pool); }
  finally { pool.query = query; pool.connect = connect; if (prior === undefined) delete process.env.DATABASE_URL; else process.env.DATABASE_URL = prior; }
}
async function localFixture() {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), 'fs-review-mission-'));
  return {base, missions: new MissionManager(path.join(base, 'missions'), 'workspace-a'), queue: new WorkerQueue(path.join(base, 'queue'), 120000, 'workspace-a')};
}

test('R01: recording mission evidence invokes its durable PostgreSQL writer', async () => {
  await withDatabase(async calls => {
    const base = await fs.mkdtemp(path.join(os.tmpdir(), 'fs-review-evidence-'));
    try {
      await new MissionManager(base, 'workspace-a').addEvidence({missionId: 'fixture-mission', kind: 'test', source: 'regression', status: 'pass', summary: 'fixture only'});
      const writes = calls.filter(x => /INSERT INTO evidence/i.test(x.sql));
      assert.equal(writes.length, 1, 'successful local append must not replace durable evidence persistence');
      assert.ok(writes[0].values.includes('workspace-a'));assert.match(writes[0].sql,/FROM missions m/);assert.match(writes[0].sql,/RETURNING workspace_id/);
    } finally { await fs.rm(base, {recursive: true, force: true}); }
  }, () => ({rows: [{workspace_id:'workspace-a'}], rowCount: 1}));
});

test('R02: service-wide stores preserve the workspace already attached to mission and work objects', async () => {
  await withDatabase(async calls => {
    const store = new PgStateStore(), now = new Date().toISOString();
    await store.saveMission({schemaVersion: 'fs-remote.mission.v1', id: 'fixture-m', workspaceId: 'workspace-a', goal: 'fixture', root: 'r', cwd: '.', status: 'running', steps: [], metadata: {}, maxRemediationAttempts: 3, createdAt: now, updatedAt: now});
    await store.saveWork({schemaVersion: 'fs-remote.work-item.v1', id: 'fixture-w', workspaceId: 'workspace-a', missionId: 'fixture-m', stepId: 's', kind: 'evidence', status: 'queued', payload: {}, attempts: 0, maxAttempts: 3, createdAt: now, updatedAt: now});
    for (const write of calls.filter(x => /INSERT INTO (missions|work_items)\(/.test(x.sql))) assert.equal(write.values.at(-1), 'workspace-a');
  }, () => ({rows: [], rowCount: 1}));
});

test('R02: a scoped store rejects an object explicitly belonging to a different workspace before writing', async () => {
  await withDatabase(async calls => {
    const now = new Date().toISOString();
    await assert.rejects(() => new PgStateStore('workspace-a').saveWork({schemaVersion: 'fs-remote.work-item.v1', id: 'fixture-w', workspaceId: 'workspace-b', missionId: 'm', stepId: 's', kind: 'evidence', status: 'queued', payload: {}, attempts: 0, maxAttempts: 3, createdAt: now, updatedAt: now}), /workspace/i);
    assert.equal(calls.length, 0);
  });
});

test('R03: local dispatch cannot select a node from another workspace', async () => {
  await withDatabase(async () => {
    await assert.rejects(() => new ExecutionRouter().dispatch({missionId: 'm-a', stepId: 's', nodeId: 'node-b', project: 'fixture', capability: 'filesystem', operation: 'read', payload: {root: 'r', path: 'marker.txt'}, executionTarget: 'local', workspaceId: 'workspace-a'}), /workspace|not found|mission/i);
  }, sql => {
    if (sql.startsWith('SELECT * FROM execution_nodes')) return {rowCount: 1, rows: [{id: 'node-b', workspace_id: 'workspace-b', status: 'online', capabilities: ['filesystem'], projects: [], metadata: {}}]};
    if (sql.includes('count(*)')) return {rowCount: 1, rows: [{n: 0, cost: 0, sandbox_minutes: 0}]};
    return {rowCount: 0, rows: []};
  });
});

test('R08: uncertain hosted Git work does not automatically replay when a worker lease expires', async () => {
  const prior = process.env.DATABASE_URL; delete process.env.DATABASE_URL;
  const f = await localFixture();
  try {
    const mission=await f.missions.create({goal:'Unsafe recovery fixture',root:'fixture',cwd:'.',steps:[{title:'Work'}]});
    const item = await f.queue.enqueue({missionId: mission.id, stepId: 'step-1', kind: 'hosted_git'});
    await f.queue.claim('worker-a', ['hosted_git'], 1);
    await new Promise(resolve => setTimeout(resolve, 15));
    await f.queue.recover();
    assert.equal((await f.queue.get(item.id)).status, 'recovery_required');
  } finally { await fs.rm(f.base, {recursive: true, force: true}); if (prior !== undefined) process.env.DATABASE_URL = prior; }
});

test('R10: completed reasoning with no execution evidence cannot complete a mission on advance/resume', async () => {
  const prior = process.env.DATABASE_URL; delete process.env.DATABASE_URL;
  const f = await localFixture();
  try {
    const mission = await f.missions.create({goal: 'Inspect fixture', root: 'fixture', cwd: '.', steps: [{title: 'Inspect', acceptance: ['Read fixture']}], metadata: {productContractResolved: true}});
    const item = await f.queue.enqueue({missionId: mission.id, stepId: 'step-1', kind: 'reasoning'});
    const claim = await f.queue.claim('worker-a', ['reasoning']);
    await f.queue.complete(item.id, 'worker-a', claim!.lease!.token, {planError: 'No execution occurred.'});
    await new MissionOrchestrator(f.missions, f.queue).advance(mission.id);
    assert.notEqual((await f.missions.get(mission.id)).status, 'completed');
  } finally { await fs.rm(f.base, {recursive: true, force: true}); if (prior !== undefined) process.env.DATABASE_URL = prior; }
});

test('R11: an unchanged planner context survives the worker-side fingerprint check', async () => {
  const prior = process.env.DATABASE_URL; delete process.env.DATABASE_URL;
  const f = await localFixture();
  try {
    const mission = await f.missions.create({goal: 'Inspect fixture', root: 'fixture', cwd: '.', steps: [{title: 'Inspect', acceptance: ['Read fixture']}], metadata: {productContractResolved: true}});
    const out = await new MissionOrchestrator(f.missions, f.queue).advance(mission.id);
    assert.equal(out.state, 'planning');
    const prompt = JSON.parse(out.work.payload.prompt), current = await f.missions.get(mission.id), evidence = await f.missions.evidence(mission.id);
    // This is the current worker input shape; a shared canonical contract must make it stable.
    const expected = {missionId: current.id, goal: current.goal, step: current.steps.find(x => x.id === 'step-1'), metadata: current.metadata, evidence: evidence.filter(x => x.stepId === 'step-1'), quality: prompt.quality};
    const plan: any = {contextFingerprint: prompt.contextFingerprint, decision: 'execute', summary: 'Read fixture', actions: [{id: 'read', nodeId: 'node-fixture', project: 'fixture', capability: 'filesystem', operation: 'read', payload: {}}]};
    assert.equal(prompt.contextFingerprint, contextFingerprint(expected));
    await assert.doesNotReject(() => new PlanDispatcher({dispatch: async () => ({fixture: true})} as any).dispatch(mission.id, 'step-1', plan, expected, 'workspace-a'));
  } finally { await fs.rm(f.base, {recursive: true, force: true}); if (prior !== undefined) process.env.DATABASE_URL = prior; }
});
