import test,{afterEach} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {MissionManager} from '../src/missions.js';
import {WorkerQueue} from '../src/workers.js';

const dirs:string[]=[];
afterEach(async()=>{for(const dir of dirs.splice(0))await fs.rm(dir,{recursive:true,force:true});});
async function fixture(){
 delete process.env.DATABASE_URL;
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'fs-local-worker-atomic-'));dirs.push(dir);
 const missions=path.join(dir,'missions'),queueBase=path.join(dir,'work-queue'),manager=new MissionManager(missions,'workspace-a');
 const mission=await manager.create({goal:'Atomic local queue fixture',root:'fixture',cwd:'.',steps:[{title:'Work'}]});
 const queue=new WorkerQueue(queueBase,5000,'workspace-a',missions);
 return{dir,missions,queueBase,manager,mission,queue};
}
async function childClaim(queueBase:string,missionBase:string,barrier:string,workerId:string){
 const workersUrl=pathToFileURL(path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../src/workers.ts')).href;
 const source=`import fs from 'node:fs/promises';import {WorkerQueue} from ${JSON.stringify(workersUrl)};const q=new WorkerQueue(process.env.Q,5000,'workspace-a',process.env.M);while(true){try{await fs.access(process.env.B);break}catch{await new Promise(r=>setTimeout(r,2))}}const x=await q.claim(process.env.W,['review_council'],5000);process.stdout.write(JSON.stringify(x?{id:x.id,worker:x.lease?.workerId}:null));`;
 const child=spawn(process.execPath,['--import','tsx','--input-type=module','--eval',source],{cwd:process.cwd(),env:{...process.env,DATABASE_URL:'',Q:queueBase,M:missionBase,B:barrier,W:workerId},stdio:['ignore','pipe','pipe']});
 let out='',err='';child.stdout.setEncoding('utf8').on('data',x=>out+=x);child.stderr.setEncoding('utf8').on('data',x=>err+=x);
 return new Promise<any>((resolve,reject)=>child.on('exit',code=>code===0?resolve(JSON.parse(out||'null')):reject(new Error(`child ${workerId} exit ${code}: ${err}`))));
}

test('LOCAL-CONCURRENCY-01 cross-process claims fence one queued item to one worker',async()=>{
 const f=await fixture();const item=await f.queue.enqueue({missionId:f.mission.id,stepId:'step-1',kind:'review_council'}),barrier=path.join(f.dir,'go');
 const attempts=Array.from({length:8},(_,i)=>childClaim(f.queueBase,f.missions,barrier,`worker-${i}`));
 await new Promise(r=>setTimeout(r,150));await fs.writeFile(barrier,'go');
 const claimed=(await Promise.all(attempts)).filter(Boolean);
 assert.equal(claimed.length,1,'exactly one process may claim the queued work item');
 assert.equal(claimed[0].id,item.id);
 const stored=await f.queue.get(item.id);assert.equal(stored.status,'leased');assert.equal(stored.attempts,1);
});

test('LOCAL-ATOMIC-01 committed completion transaction is authoritative after materialization crash',async()=>{
 const f=await fixture(),item=await f.queue.enqueue({missionId:f.mission.id,stepId:'step-1',kind:'review_council'}),claim=await f.queue.claim('worker-a',['review_council'],5000);
 assert.ok(claim?.lease);
 const committedAt=new Date().toISOString(),evidenceId='tx-evidence-1',envelope={schemaVersion:'fs-remote.execution-result.v1',executionTarget:'local',completedAt:committedAt,usage:{executionTarget:'local',wallClockMs:7,inputBytes:0,outputBytes:0,estimatedCostUsd:0,observedAt:committedAt},result:{ok:true}};
 const record={schemaVersion:'fs-remote.local-work-completion.v1',workId:item.id,missionId:f.mission.id,stepId:'step-1',workspaceId:'workspace-a',workerId:'worker-a',committedAt,result:envelope,evidence:[{schemaVersion:'fs-remote.evidence.v1',id:evidenceId,workspaceId:'workspace-a',missionId:f.mission.id,stepId:'step-1',kind:'test',source:'fixture',status:'pass',summary:'transaction evidence',observedAt:committedAt}]};
 const dir=path.join(f.missions,f.mission.id,'work-completions');await fs.mkdir(dir,{recursive:true});await fs.writeFile(path.join(dir,item.id+'.json'),JSON.stringify(record));
 const work=await new WorkerQueue(f.queueBase,5000,'workspace-a',f.missions).get(item.id);
 assert.equal(work.status,'completed');assert.deepEqual(work.result,envelope);assert.equal(work.lease,undefined);
 const evidence=await new MissionManager(f.missions,'workspace-a').evidence(f.mission.id);
 assert.equal(evidence.some(x=>x.id===evidenceId),true);
});

test('LOCAL-ATOMIC-02 prepared or unrelated completion files are never visible',async()=>{
 const f=await fixture(),item=await f.queue.enqueue({missionId:f.mission.id,stepId:'step-1',kind:'review_council'}),claim=await f.queue.claim('worker-a',['review_council'],5000);assert.ok(claim?.lease);
 const dir=path.join(f.missions,f.mission.id,'work-completions');await fs.mkdir(dir,{recursive:true});
 await fs.writeFile(path.join(dir,'.'+item.id+'.prepared-deadbeef'),JSON.stringify({schemaVersion:'fs-remote.local-work-completion.v1',workId:item.id}));
 assert.equal((await f.queue.get(item.id)).status,'leased');
 assert.equal((await f.manager.evidence(f.mission.id)).length,0);
});

test('LOCAL-ATOMIC-03 completeWithEvidence commits one durable visibility record',async()=>{
 const f=await fixture(),item=await f.queue.enqueue({missionId:f.mission.id,stepId:'step-1',kind:'review_council'}),claim=await f.queue.claim('worker-a',['review_council'],5000);assert.ok(claim?.lease);
 const done=await f.queue.completeWithEvidence(f.manager,item.id,'worker-a',claim!.lease!.token,{ok:true},[{kind:'test',source:'fixture',status:'pass',summary:'verified'}],{executionTarget:'local',wallClockMs:5,estimatedCostUsd:0});
 assert.equal(done.status,'completed');
 const tx=JSON.parse(await fs.readFile(path.join(f.missions,f.mission.id,'work-completions',item.id+'.json'),'utf8'));
 assert.equal(tx.schemaVersion,'fs-remote.local-work-completion.v1');assert.equal(tx.workId,item.id);assert.equal(tx.evidence.length,1);
 assert.equal(tx.result.executionId,item.id,'execution result must be bound to its authoritative work id');
 assert.equal(tx.evidence[0].data.executionId,item.id,'atomically committed evidence must carry the same execution id');
 const evidence=await f.manager.evidence(f.mission.id);assert.equal(evidence.filter(x=>x.summary==='verified').length,1);
 await assert.rejects(()=>fs.access(path.join(f.missions,f.mission.id,'evidence.jsonl')),'transactional completion evidence must not be separately appended before commit');
});

test('LOCAL-CONCURRENCY-02 completion cannot be resurrected by a racing heartbeat',async()=>{
 const f=await fixture(),item=await f.queue.enqueue({missionId:f.mission.id,stepId:'step-1',kind:'review_council'}),claim=await f.queue.claim('worker-a',['review_council'],5000);assert.ok(claim?.lease);
 const [completion,heartbeat]=await Promise.allSettled([
  f.queue.completeWithEvidence(f.manager,item.id,'worker-a',claim!.lease!.token,{ok:true},[{kind:'test',source:'fixture',status:'pass',summary:'complete'}],{executionTarget:'local',wallClockMs:4,estimatedCostUsd:0}),
  new WorkerQueue(f.queueBase,5000,'workspace-a',f.missions).heartbeat(item.id,'worker-a',claim!.lease!.token,5000)
 ]);
 assert.equal(completion.status,'fulfilled');
 assert.equal((await f.queue.get(item.id)).status,'completed');
 if(heartbeat.status==='fulfilled')assert.equal(heartbeat.value.status,'leased','a heartbeat may win before completion but may not overwrite it afterwards');
});

test('LOCAL-CONCURRENCY-03 queue mutation waits for an active filesystem lock',async()=>{
 const f=await fixture();const item=await f.queue.enqueue({missionId:f.mission.id,stepId:'step-1',kind:'review_council'});
 const lock=path.join(f.queueBase,'.fs-worker-queue.lock');await fs.mkdir(lock,{recursive:true});await fs.writeFile(path.join(lock,'owner.json'),JSON.stringify({pid:process.pid,host:os.hostname(),token:'fixture-active-lock',acquiredAt:new Date().toISOString()}));
 let settled=false;const claimPromise=new WorkerQueue(f.queueBase,5000,'workspace-a',f.missions).claim('worker-b',['review_council'],5000).finally(()=>{settled=true});
 await new Promise(r=>setTimeout(r,100));assert.equal(settled,false,'claim must remain blocked while another process owns the queue mutation lock');
 await fs.rm(lock,{recursive:true,force:true});
 const claim=await claimPromise;assert.equal(claim?.id,item.id);
});
