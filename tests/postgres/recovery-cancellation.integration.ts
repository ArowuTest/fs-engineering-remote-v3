import test,{before,after} from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {db,migrateDatabase} from '../../src/db.js';
import {migrateMultiUserSchema} from '../../src/multi-user-schema.js';
import {MissionManager} from '../../src/missions.js';
import {WorkerQueue} from '../../src/workers.js';

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
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'fs-pg-cancel-'));dirs.push(dir);
 const user=crypto.randomUUID(),workspace=crypto.randomUUID();
 await db().query('INSERT INTO users(id,username,password_hash) VALUES($1,$1,$2)',[user,'fixture-not-a-login-hash']);
 await db().query('INSERT INTO workspaces(id,slug,name,owner_user_id) VALUES($1,$1,$1,$2)',[workspace,user]);
 const manager=new MissionManager(path.join(dir,'missions'),workspace);
 const mission=await manager.create({goal:'Cancellation safety fixture',root:'fixture',cwd:'.',steps:[{title:'Recover work'}]});
 return{dir,workspace,mission,queue:new WorkerQueue(path.join(dir,'queue'),120000,workspace)};
}
for(const cause of ['cancel','failure','expiry'] as const){
 test(`PostgreSQL cancellation retains unsafe recovery state after ${cause}`,async()=>{
  const f=await fixture();await f.queue.enqueue({missionId:f.mission.id,stepId:'step-1',kind:'hosted_execution'});
  const work=(await f.queue.claim('owner',['hosted_execution']))!;
  if(cause==='cancel')await f.queue.cancel(work.id);
  else if(cause==='failure')await f.queue.fail(work.id,'owner',work.lease!.token,'Uncertain side effects');
  else{await db().query("UPDATE work_items SET lease_expires_at=clock_timestamp()-interval '1 second' WHERE id=$1",[work.id]);await f.queue.recover();}
  assert.equal((await f.queue.get(work.id)).status,'recovery_required');
  assert.equal((await f.queue.cancel(work.id)).status,'recovery_required','cancellation is not an inspected recovery action');
  const fresh=new WorkerQueue(path.join(f.dir,'fresh-reader'),120000,f.workspace);
  assert.equal((await fresh.get(work.id)).status,'recovery_required');
  assert.equal(await fresh.claim('different-owner',['hosted_execution']),null);
  await assert.rejects(()=>fresh.complete(work.id,'owner',work.lease!.token,{}),/lease|owned/i);
 });
}
test('PostgreSQL queued and replay-safe cancellation remains terminal',async()=>{
 const f=await fixture();const queued=await f.queue.enqueue({missionId:f.mission.id,stepId:'step-1',kind:'hosted_execution'});
 assert.equal((await f.queue.cancel(queued.id)).status,'cancelled');
 await f.queue.enqueue({missionId:f.mission.id,stepId:'step-1',kind:'evidence'});
 const safe=(await f.queue.claim('owner',['evidence']))!;
 assert.equal((await f.queue.cancel(safe.id)).status,'cancelled');
 assert.equal((await f.queue.cancel(safe.id)).status,'cancelled');
});
