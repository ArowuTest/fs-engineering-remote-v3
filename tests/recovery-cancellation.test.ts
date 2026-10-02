import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {MissionManager} from '../src/missions.js';
import {WorkerQueue} from '../src/workers.js';

for(const cause of ['cancel','failure'] as const){
 test(`local cancellation retains unsafe recovery state after ${cause}`,async()=>{
  const previous=process.env.DATABASE_URL;delete process.env.DATABASE_URL;
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'fs-cancel-recovery-'));
  try{
   const manager=new MissionManager(path.join(dir,'missions'));
   const mission=await manager.create({goal:'Cancellation safety fixture',root:'fixture',cwd:'.',steps:[{title:'Inspect uncertain work'}]});
   const queue=new WorkerQueue(path.join(dir,'queue'));
   await queue.enqueue({missionId:mission.id,stepId:'step-1',kind:'hosted_execution'});
   const work=(await queue.claim('owner',['hosted_execution']))!;
   const first=cause==='cancel'?await queue.cancel(work.id):await queue.fail(work.id,'owner',work.lease!.token,'Uncertain side effects');
   assert.equal(first.status,'recovery_required');
   assert.equal((await queue.cancel(work.id)).status,'recovery_required','repeat cancellation is not inspected recovery');
   assert.equal((await new WorkerQueue(path.join(dir,'queue')).get(work.id)).status,'recovery_required');
   assert.equal(await queue.claim('another-owner',['hosted_execution']),null);
  }finally{await fs.rm(dir,{recursive:true,force:true});if(previous===undefined)delete process.env.DATABASE_URL;else process.env.DATABASE_URL=previous;}
 });
}

test('local queued and replay-safe leased cancellation still terminates safely',async()=>{
 const previous=process.env.DATABASE_URL;delete process.env.DATABASE_URL;
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'fs-cancel-control-'));
 try{
  const manager=new MissionManager(path.join(dir,'missions'));
  const mission=await manager.create({goal:'Cancellation control',root:'fixture',cwd:'.',steps:[{title:'Read'}]});
  const queue=new WorkerQueue(path.join(dir,'queue'));
  const pending=await queue.enqueue({missionId:mission.id,stepId:'step-1',kind:'hosted_execution'});
  assert.equal((await queue.cancel(pending.id)).status,'cancelled');
  await queue.enqueue({missionId:mission.id,stepId:'step-1',kind:'evidence'});
  const safe=(await queue.claim('owner',['evidence']))!;
  assert.equal((await queue.cancel(safe.id)).status,'cancelled');
  assert.equal((await queue.cancel(safe.id)).status,'cancelled');
 }finally{await fs.rm(dir,{recursive:true,force:true});if(previous===undefined)delete process.env.DATABASE_URL;else process.env.DATABASE_URL=previous;}
});
