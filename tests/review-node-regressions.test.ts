import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import ts from 'typescript';
import { executionEvidenceStatus } from '../src/execution-outcome.js';
import { nodeRetryPolicy } from '../src/node-retry-policy.js';

// Executes the production loop, with only operation/transport boundaries replaced.
// The PostgreSQL journey suite separately exercises persistence and evidence outcomes.
test('R07: node loop never reports nonzero, failed, or timed-out execution as completed', async () => {
  const source = await fs.readFile(new URL('../src/node-main.ts', import.meta.url), 'utf8');
  const line = source.split(/\r?\n/).find(x => x.startsWith('async function workLoop()'));
  assert.ok(line, 'production work-loop entry point must exist');
  const js = ts.transpileModule(line, {compilerOptions: {target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext}}).outputText;
  const run = new Function('resultValue', 'executionEvidenceStatus', `return (async () => {
    let stopped=false,current=null,readiness={ok:true},completion=null;
    const execute=async()=>resultValue,renewLoop=async()=>{},sleep=async()=>{};
    const supervisor={failure(error){throw error}},noteConnection=()=>{};
    const post=async(route,body)=>{if(route==='/node/claim')return{id:'fixture-job',capability:'command',operation:'run',leaseToken:'fixture-lease'};if(route==='/node/complete'){completion=body;stopped=true;return {}};throw new Error('Unexpected route '+route)};
    const leaseMs=120000;
    ${js}
    await workLoop();return completion;
  })()`);
  for (const value of [{exitCode: 7, timedOut: false}, {status: 'failed', exitCode: 1}, {exitCode: null, timedOut: true}]) {
    assert.equal((await run(value, executionEvidenceStatus)).status, 'failed', JSON.stringify(value));
  }
  assert.equal((await run({exitCode: 0, timedOut: false}, executionEvidenceStatus)).status, 'completed');
});

test('S03: caller verification metadata cannot make an arbitrary command replay-safe', () => {
  for (const value of [true, {}, {run: 1}, {recipe: {command: 'deploy-production'}}]) {
    assert.equal(nodeRetryPolicy('command', 'run', {__verification: value}).policy, 'manual');
  }
  assert.equal(nodeRetryPolicy('filesystem', 'read', {}).policy, 'automatic');
});
