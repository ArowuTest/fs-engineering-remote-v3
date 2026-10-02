import test, {afterEach} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {MissionManager} from '../src/missions.js';
import {WorkerQueue} from '../src/workers.js';
import {HandoffStore} from '../src/handoff.js';

const dirs:string[]=[];
afterEach(async()=>{for(const dir of dirs.splice(0))await fs.rm(dir,{recursive:true,force:true});});
async function fixture(){
 assert.ok(!process.env.DATABASE_URL,'local fixture must not access a database');
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'fs-local-parent-'));dirs.push(dir);
 const base=path.join(dir,'missions'),owner=new MissionManager(base,'workspace-a');
 const mission=await owner.create({goal:'Local parent fixture',root:'fixture',cwd:'.',steps:[{title:'Inspect',acceptance:['fixture']} ]});
 return{dir,base,owner,mission,global:new MissionManager(base),foreign:new MissionManager(base,'workspace-b'),queue:()=>new WorkerQueue(path.join(dir,'work-queue'))};
}
const evidence=(missionId:string,stepId='step-1')=>({missionId,stepId,kind:'test',source:'local-parent-fixture',status:'pass' as const,summary:'Fixture verification'});
const handoff=(missionId:string)=>({missionId,goal:'Fixture',completed:[],decisions:[],blockers:[],pendingQuestions:[],nextActions:[],metadata:{}});

test('LOCAL-PARENT-01 global queue inherits existing mission workspace',async()=>{
 const f=await fixture(),w=await f.queue().enqueue({missionId:f.mission.id,stepId:'step-1',kind:'evidence'});
 assert.equal(w.workspaceId,'workspace-a');assert.equal((await f.queue().get(w.id)).workspaceId,'workspace-a');
});
for(const target of ['mission','step','workspace'] as const)test(`LOCAL-PARENT-02 queue rejects ${target} mismatch without writing work`,async()=>{
 const f=await fixture(),queue=new WorkerQueue(path.join(f.dir,'work-queue'),120000,target==='workspace'?'workspace-b':undefined);
 await assert.rejects(()=>queue.enqueue({missionId:target==='mission'?'missing':f.mission.id,stepId:target==='step'?'missing':'step-1',kind:'evidence'}),/mission|step|workspace/i);
 assert.equal((await f.queue().list()).length,0);
});
test('LOCAL-PARENT-03 unscoped evidence inherits ownership and survives fresh readers',async()=>{
 const f=await fixture(),e=await f.global.addEvidence(evidence(f.mission.id));assert.equal(e.workspaceId,'workspace-a');
 assert.equal((await new MissionManager(f.base,'workspace-a').evidence(f.mission.id)).length,1);
 await f.global.addEvidence({...evidence(f.mission.id),status:'fail'});
 assert.equal((await f.owner.evidence(f.mission.id)).length,2,'multiple records must remain readable');
});
for(const target of ['mission','step','workspace','explicit-workspace'] as const)test(`LOCAL-PARENT-04 evidence rejects ${target} mismatch before appending`,async()=>{
 const f=await fixture(),manager=target==='workspace'?f.foreign:f.global;
 await assert.rejects(()=>manager.addEvidence({...evidence(target==='mission'?'missing':f.mission.id,target==='step'?'missing':'step-1'),...(target==='explicit-workspace'?{workspaceId:'workspace-b'}:{})}),/mission|step|workspace/i);
 await assert.rejects(()=>fs.access(path.join(f.base,target==='mission'?'missing':f.mission.id,'evidence.jsonl')));
});
test('LOCAL-PARENT-05 global handoff inherits authoritative workspace',async()=>{
 const f=await fixture(),h=await new HandoffStore(f.base).save(handoff(f.mission.id));assert.equal(h.workspaceId,'workspace-a');
 assert.equal((await new HandoffStore(f.base,'workspace-a').latest(f.mission.id))?.id,h.id);
});
for(const target of ['mission','step','workspace','explicit-workspace'] as const)test(`LOCAL-PARENT-06 handoff rejects ${target} mismatch before writing`,async()=>{
 const f=await fixture(),store=new HandoffStore(f.base,target==='workspace'?'workspace-b':undefined);
 await assert.rejects(()=>store.save({...handoff(target==='mission'?'missing':f.mission.id),...(target==='step'?{currentStepId:'missing'}:{}),...(target==='explicit-workspace'?{workspaceId:'workspace-b'}:{})}),/mission|step|workspace/i);
 await assert.rejects(()=>fs.access(path.join(f.base,target==='mission'?'missing':f.mission.id,'handoffs')));
});
test('LOCAL-PARENT-07 traversal-like mission identifiers are rejected before filesystem writes',async()=>{
 const f=await fixture();
 for(const missionId of ['.','..','../elsewhere','a/b']){
  await assert.rejects(()=>f.global.addEvidence(evidence(missionId)),/invalid|mission|outside/i);
  await assert.rejects(()=>new HandoffStore(f.base).save(handoff(missionId)),/invalid|mission|outside/i);
 }
 await assert.rejects(()=>fs.access(path.join(f.dir,'evidence.jsonl')));
});
test('LOCAL-PARENT-08 stored mission identity must agree with its directory',async()=>{
 const f=await fixture(),file=path.join(f.base,f.mission.id,'mission.json');
 await fs.writeFile(file,JSON.stringify({...f.mission,id:'another-mission'}));
 await assert.rejects(()=>f.owner.get(f.mission.id),/identity|mission|corrupt/i);
 await assert.rejects(()=>f.queue().enqueue({missionId:f.mission.id,stepId:'step-1',kind:'evidence'}),/identity|mission|corrupt/i);
});
test('LOCAL-READ-01 corrupt evidence is not reported as empty history',async()=>{
 const f=await fixture();await fs.writeFile(path.join(f.base,f.mission.id,'evidence.jsonl'),'{"broken":');
 await assert.rejects(()=>f.owner.evidence(f.mission.id),/corrupt|evidence|JSON/i);
});
test('LOCAL-READ-02 corrupt handoff is not reported as absent',async()=>{
 const f=await fixture();await fs.writeFile(path.join(f.base,f.mission.id,'latest-handoff.json'),'{"broken":');
 await assert.rejects(()=>new HandoffStore(f.base,'workspace-a').latest(f.mission.id),/corrupt|handoff|JSON/i);
});
test('LOCAL-READ-03 evidence with a foreign parent cannot contaminate a local mission',async()=>{
 const f=await fixture();await fs.writeFile(path.join(f.base,f.mission.id,'evidence.jsonl'),JSON.stringify({schemaVersion:'fs-remote.evidence.v1',id:'foreign-evidence',missionId:'another',workspaceId:'workspace-a',kind:'test',source:'fixture',status:'pass',summary:'wrong parent',observedAt:new Date().toISOString()})+'\n');
 await assert.rejects(()=>f.owner.evidence(f.mission.id),/identity|mission|evidence|parent/i);
});
test('LOCAL-READ-04 absent valid-mission evidence and handoff retain their empty contract',async()=>{
 const f=await fixture();assert.deepEqual(await f.owner.evidence(f.mission.id),[]);assert.equal(await new HandoffStore(f.base,'workspace-a').latest(f.mission.id),null);
});

test('LOCAL-READ-05 successive scoped evidence writes use real record separators',async()=>{
 const f=await fixture();await f.owner.addEvidence(evidence(f.mission.id));await f.owner.addEvidence({...evidence(f.mission.id),status:'fail'});
 const records=await f.owner.evidence(f.mission.id);assert.equal(records.length,2);assert.deepEqual(records.map(x=>x.status),['pass','fail']);
});
test('LOCAL-READ-06 queue readers reject foreign record identity and corrupt persisted work',async()=>{
 const f=await fixture(),w=await f.queue().enqueue({missionId:f.mission.id,stepId:'step-1',kind:'evidence'}),file=path.join(f.dir,'work-queue',w.id+'.json');
 await fs.writeFile(file,JSON.stringify({...w,id:'different'}));await assert.rejects(()=>f.queue().get(w.id),/identity|work|corrupt/i);
 await fs.writeFile(file,'{"broken":');await assert.rejects(()=>f.queue().list(),/corrupt|work|JSON/i);
});
test('LOCAL-READ-07 handoff content must match the parent, not just the workspace',async()=>{
 const f=await fixture();await fs.writeFile(path.join(f.base,f.mission.id,'latest-handoff.json'),JSON.stringify({schemaVersion:'fs-remote.handoff.v1',id:'wrong-handoff',workspaceId:'workspace-a',createdAt:new Date().toISOString(),...handoff('another')}));
 await assert.rejects(()=>new HandoffStore(f.base,'workspace-a').latest(f.mission.id),/parent|mission|handoff|corrupt/i);
});

for(const steps of [[null],[{id:23}],[{id:'step-1'},{id:'step-1'}]])test(`LOCAL-STRUCTURE-01 malformed or duplicate mission steps fail at the parent boundary ${JSON.stringify(steps)}`,async()=>{
 const f=await fixture();await fs.writeFile(path.join(f.base,f.mission.id,'mission.json'),JSON.stringify({...f.mission,steps}));
 await assert.rejects(()=>f.owner.get(f.mission.id),/Invalid local mission identity or structure/);
});
test('LOCAL-STRUCTURE-02 corrupt mission entries cannot disappear from the mission list',async()=>{
 const f=await fixture();await fs.writeFile(path.join(f.base,f.mission.id,'mission.json'),'{"broken":');
 await assert.rejects(()=>f.owner.list(),/Corrupt local mission/);
});
for(const field of ['missionId','stepId'] as const)test(`LOCAL-STRUCTURE-03 work ${field} type must be validated before coercion`,async()=>{
 const f=await fixture(),w=await f.queue().enqueue({missionId:f.mission.id,stepId:'step-1',kind:'evidence'});
 await fs.writeFile(path.join(f.dir,'work-queue',w.id+'.json'),JSON.stringify({...w,[field]:23}));
 await assert.rejects(()=>f.queue().get(w.id),/Invalid local work identity or parent fields/);
});
test('LOCAL-LEGACY-01 unassigned legacy history is preserved but never silently assigned to a workspace',async()=>{
 const f=await fixture(),file=path.join(f.base,f.mission.id,'evidence.jsonl');
 const legacy={schemaVersion:'fs-remote.evidence.v1',id:'legacy-evidence',missionId:f.mission.id,kind:'test',source:'legacy',status:'pass',summary:'Legacy unassigned fixture',observedAt:new Date().toISOString()};
 const text=JSON.stringify(legacy)+'\n';await fs.writeFile(file,text);
 await assert.rejects(()=>f.global.evidence(f.mission.id),/LOCAL_STATE_RECONCILIATION_REQUIRED/);
 assert.equal(await fs.readFile(file,'utf8'),text,'historical bytes must not be changed by inspection');
});
