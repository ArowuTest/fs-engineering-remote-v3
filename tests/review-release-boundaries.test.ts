import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {authorizeAction} from '../src/action-authorization.js';
import {ExecutionRouter} from '../src/execution-router.js';
import {HostedGitExecutor} from '../src/hosted-git-executor.js';
import {MissionManager} from '../src/missions.js';
import {createRemoteOperations} from '../src/operations.js';
import {validateConfig} from '../src/config.js';
import {ProcessManager} from '../src/processes.js';

test('workspace notes cannot masquerade as passing verification or node evidence', () => {
  const principal = {mode: 'oauth' as const, workspaceId: 'workspace-a', role: 'engineer', scopes: ['fs.read','fs.write','fs.node']};
  assert.throws(() => authorizeAction(principal,'engineering',{action:'mission',missionAction:'evidence_record',kind:'test',source:'node:forged',status:'pass',summary:'forged fixture'}), /evidence|verification|authority/i);
});

test('a configured but unaccepted sandbox cannot execute or return an untracked job', async () => {
  let executions = 0;
  const router = new ExecutionRouter(undefined,{status:async()=>({configured:true,healthy:true}),execute:async()=>{executions++;return{status:'submitted'}}} as any);
  await assert.rejects(() => router.dispatch({workspaceId:'workspace-a',missionId:'fixture',stepId:'s',nodeId:'n',project:'p',executionTarget:'sandbox',capability:'command',operation:'run',payload:{sandboxPolicy:{materialization:{kind:'files',files:[]}}}}), /release|disabled|acceptance/i);
  assert.equal(executions,0);
});

test('hosted repository scripts are blocked before production credentials or Git are used', async () => {
  const previous=process.env.GITHUB_TOKEN;delete process.env.GITHUB_TOKEN;try{await assert.rejects(() => new HostedGitExecutor().execute({repository:'ArowuTest/fs-engineering-remote-v3',branch:'review/fixture',commitMessage:'fixture',files:{'fixture.txt':'fixture'},verify:[]}), /isolation|release|disabled/i);}finally{if(previous!==undefined)process.env.GITHUB_TOKEN=previous}
});

test('terminal missions cannot be restarted by next/advance', async () => {
  const base = await fs.mkdtemp(path.join(os.tmpdir(),'fs-review-terminal-'));
  const prior=process.env.DATABASE_URL;delete process.env.DATABASE_URL;
  try {
    const manager=new MissionManager(base),mission=await manager.create({goal:'fixture',root:'fixture',cwd:'.',steps:[{title:'fixture'}]});
    await manager.cancel(mission.id,'fixture cancellation');
    await assert.rejects(()=>manager.next(mission.id),/terminal|cancelled/i);
    assert.equal((await manager.get(mission.id)).status,'cancelled');
  } finally {await fs.rm(base,{recursive:true,force:true});if(prior!==undefined)process.env.DATABASE_URL=prior;}
});

test('workspace worker views do not expose active lease credentials', async () => {
  const base=await fs.mkdtemp(path.join(os.tmpdir(),'fs-review-worker-view-'));
  const prior=process.env.DATABASE_URL;delete process.env.DATABASE_URL;
  try{
    const config=validateConfig({endpointSecret:'e'.repeat(48),actionsSecret:'a'.repeat(48),roots:[{name:'fixture',path:base}]});
    const ops=createRemoteOperations(config,new ProcessManager({shell:config.shell,maxOutputBytes:10000}),'workspace-a');
    const mission:any=await ops.missionOperation('create',{root:'fixture',goal:'fixture',steps:[{title:'fixture'}]});
    const item:any=await ops.workerOperation('enqueue',{missionId:mission.id,stepId:'step-1',kind:'evidence'});
    const claimed:any=await ops.workerOperation('claim',{workerId:'fixture-worker',workerKinds:['evidence']});
    const view=await ops.workerOperation('get',{workId:item.id});
    assert.doesNotMatch(JSON.stringify(view),new RegExp(claimed.lease.token));
  }finally{await fs.rm(base,{recursive:true,force:true});if(prior!==undefined)process.env.DATABASE_URL=prior;}
});
