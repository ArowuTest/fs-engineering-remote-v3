import test,{before,after} from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {db,migrateDatabase} from '../../src/db.js';
import {migrateMultiUserSchema} from '../../src/multi-user-schema.js';
import {MissionManager} from '../../src/missions.js';
import {PgStateStore} from '../../src/pg-state.js';
import {WorkerQueue,type WorkItem} from '../../src/workers.js';

const raw=process.env.FS_REVIEW_PG_URL;
if(!raw)throw new Error('FS_REVIEW_PG_URL must explicitly name an isolated local review database.');
const url=new URL(raw);
if(!['127.0.0.1','localhost','[::1]'].includes(url.hostname)||!/^\/fs_v3_review(?:_[a-z0-9]+)?$/.test(url.pathname)||url.username!=='fs_review')throw new Error('Refusing non-local or non-review PostgreSQL target.');
const schema=`review_${crypto.randomBytes(8).toString('hex')}`;
url.searchParams.set('options',`-c search_path=${schema}`);
process.env.DATABASE_URL=url.toString();process.env.FS_REMOTE_INSTANCE_ID=schema;
const dirs:string[]=[];
before(async()=>{await db().query(`CREATE SCHEMA ${schema}`);await migrateDatabase();await migrateMultiUserSchema();});
after(async()=>{try{await db().query(`DROP SCHEMA ${schema} CASCADE`);}finally{await db().end();for(const dir of dirs)await fs.rm(dir,{recursive:true,force:true});}});
async function fixture(){
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'fs-pg-parent-'));dirs.push(dir);
 const user=crypto.randomUUID(),a=crypto.randomUUID(),b=crypto.randomUUID();
 await db().query('INSERT INTO users(id,username,password_hash) VALUES($1,$1,$2)',[user,'fixture-not-a-login-hash']);
 for(const workspace of [a,b])await db().query('INSERT INTO workspaces(id,slug,name,owner_user_id) VALUES($1,$1,$1,$2)',[workspace,user]);
 const manager=new MissionManager(path.join(dir,'missions'),a);
 const input={goal:'Persistence parent fixture',root:'fixture',cwd:'.',steps:[{title:'First'},{title:'Second'}]};
 const mission=await manager.create(input),other=await manager.create(input);
 const now=new Date().toISOString();
 const work:WorkItem={schemaVersion:'fs-remote.work-item.v1',id:crypto.randomUUID(),missionId:mission.id,stepId:'step-1',kind:'evidence',status:'queued',payload:{fixture:'original'},attempts:0,maxAttempts:3,createdAt:now,updatedAt:now};
 return{dir,a,b,mission,other,work};
}

test('SAVE-PARENT-01 unscoped direct save inherits authoritative mission workspace',async()=>{
 const f=await fixture(),store=new PgStateStore();await store.saveWork(f.work);
 const row=(await db().query('SELECT workspace_id,mission_id,step_id FROM work_items WHERE id=$1',[f.work.id])).rows[0];
 assert.equal(row.workspace_id,f.a);assert.equal(row.mission_id,f.mission.id);assert.equal(row.step_id,'step-1');
 assert.equal((await new PgStateStore(f.a).getWork(f.work.id))?.workspaceId,f.a);
});
for(const invalid of ['step','mission','workspace','instance'] as const){
 test(`SAVE-PARENT-02 direct save rejects an invalid parent ${invalid}`,async()=>{
  const f=await fixture(),store=new PgStateStore(invalid==='workspace'?f.b:f.a);
  const candidate={...f.work,...(invalid==='step'?{stepId:'missing'}:{}),...(invalid==='mission'?{missionId:crypto.randomUUID()}:{})};
  const prior=process.env.FS_REMOTE_INSTANCE_ID;
  try{
   if(invalid==='instance')process.env.FS_REMOTE_INSTANCE_ID='foreign-instance';
   await assert.rejects(()=>store.saveWork(candidate),/mission|step|workspace|parent|foreign key/i);
  }finally{process.env.FS_REMOTE_INSTANCE_ID=prior;}
  assert.equal((await db().query('SELECT count(*)::int n FROM work_items WHERE id=$1',[f.work.id])).rows[0].n,0);
 });
}
for(const changed of ['mission','step','kind'] as const){
 test(`SAVE-PARENT-03 upsert cannot overwrite an existing work identity from a different ${changed}`,async()=>{
  const f=await fixture(),store=new PgStateStore(f.a);await store.saveWork(f.work);
  const candidate={...f.work,status:'failed' as const,payload:{fixture:'wrong-identity'},...(changed==='mission'?{missionId:f.other.id}:{}),...(changed==='step'?{stepId:'step-2'}:{}),...(changed==='kind'?{kind:'hosted_execution'}:{})};
  await assert.rejects(()=>store.saveWork(candidate),/identity|mission|step|workspace|conflict/i);
  const row=await store.getWork(f.work.id);assert.equal(row?.status,'queued');assert.deepEqual(row?.payload,{fixture:'original'});assert.equal(row?.missionId,f.mission.id);assert.equal(row?.stepId,'step-1');assert.equal(row?.kind,'evidence');
 });
}
test('SAVE-PARENT-04 valid same-parent create and update retain compatibility',async()=>{
 const f=await fixture(),store=new PgStateStore(f.a);await store.saveWork(f.work);
 await store.saveWork({...f.work,status:'failed',error:'fixture failure'});
 const row=await store.getWork(f.work.id);assert.equal(row?.workspaceId,f.a);assert.equal(row?.missionId,f.mission.id);assert.equal(row?.status,'failed');assert.equal(row?.error,'fixture failure');
});

for(const state of ['leased','expired','recovery_required','retried'] as const){
 test(`SAVE-LEASE-01 generic snapshots cannot overwrite ${state} execution`,async()=>{
  const f=await fixture(),store=new PgStateStore(f.a),queue=new WorkerQueue(path.join(f.dir,'queue'),120000,f.a);
  const original=await queue.enqueue({missionId:f.mission.id,stepId:'step-1',kind:'hosted_execution'});
  const claimed=(await queue.claim('real-owner',['hosted_execution']))!;
  if(state==='expired')await db().query("UPDATE work_items SET lease_expires_at=clock_timestamp()-interval '1 second' WHERE id=$1",[original.id]);
  if(state==='recovery_required'||state==='retried')await queue.cancel(original.id);
  if(state==='retried')await queue.retry(original.id,'Fixture inspection authorizes one retry; snapshots still cannot reset attempts.');
  const before=await store.getWork(original.id);
  await assert.rejects(()=>store.saveWork(original),/lease|fenced|state|identity|conflict/i);
  assert.deepEqual(await store.getWork(original.id),before);
  if(state==='leased'){
   await assert.rejects(()=>store.saveWork({...claimed,status:'completed',lease:undefined}),/lease|fenced|state|identity|conflict/i);
   assert.deepEqual(await store.getWork(original.id),before);
   await queue.complete(original.id,'real-owner',claimed.lease!.token,{fixture:'actual owned completion'});
   assert.equal((await queue.get(original.id)).status,'completed');
  }
 });
}
for(const status of ['leased','completed','recovery_required'] as const){
 test(`SAVE-LEASE-02 generic snapshots cannot create already-${status} work`,async()=>{
  const f=await fixture(),store=new PgStateStore(f.a);
  const work={...f.work,status,attempts:1,lease:{workerId:'forged-owner',token:'fixture-token',leasedAt:f.work.createdAt,heartbeatAt:f.work.createdAt,expiresAt:new Date(Date.now()+60000).toISOString()}};
  await assert.rejects(()=>store.saveWork(work),/lease|fenced|state|identity|conflict/i);
  assert.equal(await store.getWork(work.id),null);
 });
}

test('READ-LEASE-01 unscoped client reads hide tokens while explicit claim still issues an owner credential',async()=>{
 const {RemoteOperations}=await import('../../src/operations.js');
 const {ProcessManager}=await import('../../src/processes.js');
 const {validateConfig}=await import('../../src/config.js');
 const f=await fixture(),queue=new WorkerQueue(path.join(f.dir,'queue'),120000,f.a);
 const config=validateConfig({endpointSecret:'e'.repeat(48),actionsSecret:'a'.repeat(48),roots:[{name:'fixture',path:f.dir}]});
 const ops=new RemoteOperations(config,new ProcessManager({shell:process.platform==='win32'?'powershell.exe':'/bin/sh',maxOutputBytes:10000,stateDir:path.join(f.dir,'sessions')}));
 const pending=await queue.enqueue({missionId:f.mission.id,stepId:'step-1',kind:'unscoped-token-fixture'});
 const claimed=await ops.workerOperation('claim',{workerId:'explicit-owner',workerKinds:['unscoped-token-fixture']}) as WorkItem;
 assert.equal(claimed.id,pending.id);assert.ok(claimed.lease?.token);
 for(const action of ['get','list']){
  const result=await ops.workerOperation(action,{workId:claimed.id});
  const serialized=JSON.stringify(result);
  assert.ok(!serialized.includes(claimed.lease!.token),'ordinary client read must not reveal an existing owner credential');
  assert.ok(!serialized.includes('__leaseToken'));
 }
 const actual=await queue.get(claimed.id);assert.equal(actual.lease?.token,claimed.lease!.token,'serialization must not erase internal owner state');
 await queue.complete(claimed.id,'explicit-owner',claimed.lease!.token,{fixture:'owned completion'});
});
