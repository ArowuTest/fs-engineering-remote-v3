import {assertLeaseDuration} from './lease-duration.js';
import {AccountingStore} from './accounting-store.js';import type {ExecutionUsage} from './accounting.js';import {REPLAY_SAFE_WORK_KINDS} from './worker-retry-policy.js';import crypto from 'node:crypto';import {db,databaseEnabled} from './db.js';import type {Mission,MissionStep,Evidence} from './missions.js';import type {WorkItem} from './workers.js';import type {MissionHandoff} from './handoff.js';
const iid=()=>process.env.FS_REMOTE_INSTANCE_ID??'v3-default';
export class PgStateStore{
 constructor(private readonly workspaceId?:string){}
 private workspace(){return this.workspaceId??null}
 private workspaceFor(value?:string){if(this.workspaceId&&value&&value!==this.workspaceId)throw new Error('Cross-workspace write denied.');return this.workspaceId??value??null}
 enabled(){return databaseEnabled()}
 async saveMission(m:Mission){const workspaceId=this.workspaceFor(m.workspaceId);if(!this.enabled())return;const c=await db().connect();try{await c.query('BEGIN');const saved=await c.query(`INSERT INTO missions(id,instance_id,alias,goal,root,cwd,status,current_step_id,max_remediation_attempts,metadata,created_at,updated_at,workspace_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) ON CONFLICT(id) DO UPDATE SET alias=EXCLUDED.alias,goal=EXCLUDED.goal,root=EXCLUDED.root,cwd=EXCLUDED.cwd,status=EXCLUDED.status,current_step_id=EXCLUDED.current_step_id,max_remediation_attempts=EXCLUDED.max_remediation_attempts,metadata=EXCLUDED.metadata,workspace_id=EXCLUDED.workspace_id,updated_at=EXCLUDED.updated_at WHERE missions.instance_id=EXCLUDED.instance_id AND missions.workspace_id IS NOT DISTINCT FROM EXCLUDED.workspace_id RETURNING id`,[m.id,iid(),m.alias??null,m.goal,m.root,m.cwd,m.status,m.currentStepId??null,m.maxRemediationAttempts,m.metadata,m.createdAt,m.updatedAt,workspaceId]);if(!saved.rowCount)throw new Error('Mission identity/workspace conflict.');await c.query('DELETE FROM mission_steps WHERE mission_id=$1',[m.id]);for(let i=0;i<m.steps.length;i++){const s=m.steps[i];await c.query(`INSERT INTO mission_steps(id,mission_id,ordinal,title,acceptance,requires_approval,status,attempts,started_at,completed_at,last_error) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,[`${m.id}:${s.id}`,m.id,i,s.title,JSON.stringify(s.acceptance),s.requiresApproval,s.status,s.attempts,s.startedAt??null,s.completedAt??null,s.lastError??null])}await c.query('COMMIT')}catch(e){await c.query('ROLLBACK');throw e}finally{c.release()}}
 async getMission(id:string){if(!this.enabled())return null;const r=await db().query('SELECT * FROM missions WHERE id=$1 AND instance_id=$2 AND ($3::text IS NULL OR workspace_id=$3)',[id,iid(),this.workspace()]);if(!r.rowCount)return null;const sr=await db().query('SELECT * FROM mission_steps WHERE mission_id=$1 ORDER BY ordinal',[id]);const x=r.rows[0];return {schemaVersion:'fs-remote.mission.v1',id:x.id,workspaceId:x.workspace_id??undefined,alias:x.alias??undefined,goal:x.goal,root:x.root,cwd:x.cwd,status:x.status,createdAt:new Date(x.created_at).toISOString(),updatedAt:new Date(x.updated_at).toISOString(),currentStepId:x.current_step_id??undefined,maxRemediationAttempts:x.max_remediation_attempts,metadata:x.metadata??{},steps:sr.rows.map((s:any)=>({id:String(s.id).split(':').slice(-1)[0],title:s.title,status:s.status,acceptance:s.acceptance??[],requiresApproval:s.requires_approval,attempts:s.attempts,startedAt:s.started_at?new Date(s.started_at).toISOString():undefined,completedAt:s.completed_at?new Date(s.completed_at).toISOString():undefined,lastError:s.last_error??undefined}))} as Mission}
 async listMissions(){if(!this.enabled())return null;const r=await db().query('SELECT id FROM missions WHERE instance_id=$1 AND ($2::text IS NULL OR workspace_id=$2) ORDER BY updated_at DESC',[iid(),this.workspace()]);return Promise.all(r.rows.map((x:any)=>this.getMission(x.id))) as Promise<Mission[]>}
 async addEvidence(e:Evidence){
  const workspaceId=this.workspaceFor(e.workspaceId);if(!this.enabled())return;
  const inserted=await db().query(`INSERT INTO evidence(id,instance_id,mission_id,step_id,kind,source,status,summary,payload,observed_at,workspace_id)
   SELECT $1,$2,m.id,$4,$5,$6,$7,$8,$9,$10,m.workspace_id FROM missions m
   WHERE m.id=$3 AND m.instance_id=$2 AND ($11::text IS NULL OR m.workspace_id=$11)
   AND ($4::text IS NULL OR EXISTS(SELECT 1 FROM mission_steps s WHERE s.mission_id=m.id AND s.id=m.id||':'||$4))
   ON CONFLICT(id) DO NOTHING RETURNING workspace_id`,[e.id,iid(),e.missionId,e.stepId??null,e.kind,e.source,e.status,e.summary,e.data??null,e.observedAt,workspaceId]);
  if(!inserted.rowCount)throw new Error('Evidence mission/step not found in this workspace or evidence identity already exists.');
  return{workspaceId:inserted.rows[0].workspace_id??undefined};
 }

 async evidence(missionId:string){if(!this.enabled())return null;const r=await db().query('SELECT * FROM evidence WHERE instance_id=$1 AND mission_id=$2 AND ($3::text IS NULL OR workspace_id=$3) ORDER BY observed_at,id',[iid(),missionId,this.workspace()]);return r.rows.map((x:any)=>({schemaVersion:'fs-remote.evidence.v1',id:x.id,workspaceId:x.workspace_id??undefined,missionId:x.mission_id,stepId:x.step_id??undefined,kind:x.kind,source:x.source,status:x.status,summary:x.summary,observedAt:new Date(x.observed_at).toISOString(),data:x.payload??undefined})) as Evidence[]}
 async saveWork(w:WorkItem){
  const workspaceId=this.workspaceFor(w.workspaceId);if(!this.enabled())return;
  // Snapshot saves are only for work that has never started. Execution transitions
  // must use claim/updateOwnedWork/completeWorkWithEvidence or inspected recovery.
  if(!['queued','failed','cancelled'].includes(w.status)||w.attempts!==0||w.lease||Object.hasOwn(w.payload,'__leaseToken'))throw new Error('Work item execution state requires a fenced transition, not a snapshot save.');
  // The mission owns the workspace; an existing work identity cannot change parent or kind.
  const saved=await db().query(`INSERT INTO work_items(id,instance_id,mission_id,step_id,kind,status,payload,attempts,max_attempts,available_at,lease_owner,lease_expires_at,error,result,created_at,updated_at,workspace_id)
   SELECT $1,$2,m.id,$4,$5,$6,$7,$8,$9,now(),$10,$11,$12,$13,$14,$15,m.workspace_id
   FROM missions m JOIN mission_steps s ON s.mission_id=m.id
   WHERE m.id=$3 AND m.instance_id=$2 AND s.id=m.id||':'||$4
     AND ($16::text IS NULL OR m.workspace_id=$16)
   ON CONFLICT(id) DO UPDATE SET status=EXCLUDED.status,payload=EXCLUDED.payload,attempts=EXCLUDED.attempts,max_attempts=EXCLUDED.max_attempts,lease_owner=EXCLUDED.lease_owner,lease_expires_at=EXCLUDED.lease_expires_at,error=EXCLUDED.error,result=EXCLUDED.result,workspace_id=EXCLUDED.workspace_id,updated_at=EXCLUDED.updated_at
   WHERE work_items.instance_id=EXCLUDED.instance_id AND work_items.workspace_id IS NOT DISTINCT FROM EXCLUDED.workspace_id
     AND work_items.mission_id=EXCLUDED.mission_id AND work_items.step_id=EXCLUDED.step_id AND work_items.kind=EXCLUDED.kind
     AND work_items.status='queued' AND work_items.attempts=0
     AND work_items.lease_owner IS NULL AND work_items.lease_expires_at IS NULL
   RETURNING id`,[w.id,iid(),w.missionId,w.stepId,w.kind,w.status,w.payload,w.attempts,w.maxAttempts,null,null,w.error??null,w.result??null,w.createdAt,w.updatedAt,workspaceId]);
  if(!saved.rowCount)throw new Error('Work item parent mission/step missing or identity/workspace conflict.');
 }
 async enqueueWork(w:WorkItem){
  if(!this.enabled())throw new Error('Durable enqueue requires a database.');
  const workspaceId=this.workspaceFor(w.workspaceId);
  // New coordinator work inherits ownership from the existing mission, never
  // from an omitted queue scope or a caller-controlled payload. Validation and
  // insertion share a single database statement/snapshot.
  const saved=await db().query(`
   INSERT INTO work_items(id,instance_id,mission_id,step_id,kind,status,payload,
     attempts,max_attempts,available_at,created_at,updated_at,workspace_id)
   SELECT $1,$2,m.id,$4,$5,'queued',$6::jsonb,0,$7,now(),$8,$8,m.workspace_id
   FROM missions m JOIN mission_steps s ON s.mission_id=m.id
   WHERE m.id=$3 AND m.instance_id=$2 AND s.id=$9
     AND ($10::text IS NULL OR m.workspace_id=$10)
   RETURNING *`,[w.id,iid(),w.missionId,w.stepId,w.kind,JSON.stringify(w.payload),
    w.maxAttempts,w.createdAt,`${w.missionId}:${w.stepId}`,workspaceId]);
  if(!saved.rowCount)throw new Error('Mission/step not found in this workspace.');
  return this.workRow(saved.rows[0]);
 }
 async getWork(id:string){if(!this.enabled())return null;const r=await db().query('SELECT * FROM work_items WHERE id=$1 AND instance_id=$2 AND ($3::text IS NULL OR workspace_id=$3)',[id,iid(),this.workspace()]);if(!r.rowCount)return null;return this.workRow(r.rows[0])}
 private workRow(x:any):WorkItem{return {schemaVersion:'fs-remote.work-item.v1',id:x.id,workspaceId:x.workspace_id??undefined,missionId:x.mission_id,stepId:x.step_id,kind:x.kind,payload:x.payload??{},status:x.status,createdAt:new Date(x.created_at).toISOString(),updatedAt:new Date(x.updated_at).toISOString(),attempts:x.attempts,maxAttempts:x.max_attempts,lease:x.lease_owner?{workerId:x.lease_owner,token:String((x.payload??{}).__leaseToken??''),leasedAt:new Date(x.payload?.__leasedAt??x.updated_at).toISOString(),heartbeatAt:new Date(x.updated_at).toISOString(),expiresAt:new Date(x.lease_expires_at).toISOString()}:undefined,result:x.result??undefined,error:x.error??undefined}}
 async listWork(){if(!this.enabled())return null;const r=await db().query('SELECT * FROM work_items WHERE instance_id=$1 AND ($2::text IS NULL OR workspace_id=$2) ORDER BY created_at',[iid(),this.workspace()]);return r.rows.map((x:any)=>this.workRow(x))}
 async claim(workerId:string,kinds:string[],leaseMs:number){assertLeaseDuration(leaseMs);if(!this.enabled())return undefined;const token=crypto.randomBytes(24).toString('hex'),c=await db().connect();try{await c.query('BEGIN');const r=await c.query(`SELECT * FROM work_items WHERE instance_id=$1 AND ($3::text IS NULL OR workspace_id=$3) AND status='queued' AND available_at<=now() AND ($2::text[]='{}' OR kind=ANY($2)) ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 1`,[iid(),kinds,this.workspace()]);if(!r.rowCount){await c.query('COMMIT');return null}const x=r.rows[0],payload={...(x.payload??{}),__leaseToken:token};const u=await c.query(`UPDATE work_items SET status='leased',attempts=attempts+1,lease_owner=$2,lease_expires_at=now()+($3::text||' milliseconds')::interval,payload=$4::jsonb||jsonb_build_object('__leasedAt',clock_timestamp()),updated_at=now() WHERE id=$1 RETURNING *`,[x.id,workerId,leaseMs,payload]);await c.query('COMMIT');return this.workRow(u.rows[0])}catch(e){await c.query('ROLLBACK');throw e}finally{c.release()}}
 async completeWorkWithEvidence(id:string,workerId:string,token:string,result:Record<string,unknown>,evidence:Array<{kind:string;source:string;status:'pass'|'fail'|'info'|'unknown';summary:string;data?:Record<string,unknown>}>,usage:ExecutionUsage){
  if(!this.enabled())return undefined;
  const c=await db().connect();try{
   await c.query('BEGIN');
   const locked=await c.query(`SELECT * FROM work_items WHERE id=$1 AND instance_id=$2 AND lease_owner=$3 AND payload->>'__leaseToken'=$4 AND ($5::text IS NULL OR workspace_id=$5) AND status='leased' AND lease_expires_at>clock_timestamp() FOR UPDATE`,[id,iid(),workerId,token,this.workspace()]);
   if(!locked.rowCount)throw new Error('Work item lease is not owned or has expired.');
   const row=locked.rows[0];
   for(const e of evidence)await c.query(`INSERT INTO evidence(id,instance_id,mission_id,step_id,kind,source,status,summary,payload,observed_at,workspace_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,now(),$10)`,[`work-evidence-${crypto.randomUUID()}`,iid(),row.mission_id,row.step_id,e.kind,e.source,e.status,e.summary,{...(e.data??{}),executionId:row.id},row.workspace_id??null]);
   const accounted=await new AccountingStore(row.workspace_id??undefined).record(usage,row.mission_id,row.step_id,c);
   const envelope={schemaVersion:'fs-remote.execution-result.v1',executionId:row.id,executionTarget:usage.executionTarget,completedAt:new Date().toISOString(),usage:accounted,result};
   const updated=await c.query(`UPDATE work_items SET status='completed',result=$6::jsonb,error=NULL,lease_owner=NULL,lease_expires_at=NULL,payload=payload-'__leaseToken',updated_at=now() WHERE id=$1 AND instance_id=$2 AND lease_owner=$3 AND payload->>'__leaseToken'=$4 AND ($5::text IS NULL OR workspace_id=$5) AND status='leased' AND lease_expires_at>clock_timestamp() RETURNING *`,[id,iid(),workerId,token,this.workspace(),JSON.stringify(envelope)]);
   if(!updated.rowCount)throw new Error('Work item lease expired before evidence commit.');
   await c.query('COMMIT');return this.workRow(updated.rows[0]);
  }catch(error){await c.query('ROLLBACK');throw error}finally{c.release()}
 }
 async recoverWork(){
  if(!this.enabled())return undefined;
  const r=await db().query(`UPDATE work_items SET status=CASE WHEN NOT(kind=ANY($3::text[])) THEN 'recovery_required' WHEN attempts>=max_attempts THEN 'failed' ELSE 'queued' END,lease_owner=NULL,lease_expires_at=NULL,payload=payload-'__leaseToken',error='Worker lease expired; replay policy applied.',updated_at=now() WHERE instance_id=$1 AND ($2::text IS NULL OR workspace_id=$2) AND status='leased' AND lease_expires_at<=clock_timestamp() RETURNING status`,[iid(),this.workspace(),[...REPLAY_SAFE_WORK_KINDS]]);
  return{recovered:r.rows.filter(x=>x.status==='queued').length,failed:r.rows.filter(x=>x.status==='failed').length,recoveryRequired:r.rows.filter(x=>x.status==='recovery_required').length};
 }
 async updateOwnedWork(id:string,workerId:string,token:string,action:'heartbeat'|'complete'|'fail',options:{leaseMs?:number;result?:Record<string,unknown>;error?:string;retry?:boolean}={}){
  if(!this.enabled())return undefined;
  if(action==='heartbeat')assertLeaseDuration(options.leaseMs!);
  const assignments=action==='heartbeat'?`lease_expires_at=clock_timestamp()+($6::text||' milliseconds')::interval`:action==='complete'?`status='completed',result=$6::jsonb,error=NULL,lease_owner=NULL,lease_expires_at=NULL,payload=payload-'__leaseToken'`:`status=CASE WHEN NOT(kind=ANY($8::text[])) THEN 'recovery_required' WHEN $7::boolean AND attempts<max_attempts THEN 'queued' ELSE 'failed' END,error=$6,lease_owner=NULL,lease_expires_at=NULL,payload=payload-'__leaseToken'`;
  const values:unknown[]=[id,iid(),workerId,token,this.workspace(),action==='heartbeat'?options.leaseMs:action==='complete'?JSON.stringify(options.result??{}):options.error??'Worker failed.'];
  if(action==='fail')values.push(options.retry!==false,[...REPLAY_SAFE_WORK_KINDS]);
  const r=await db().query(`UPDATE work_items SET ${assignments},updated_at=now() WHERE id=$1 AND instance_id=$2 AND lease_owner=$3 AND payload->>'__leaseToken'=$4 AND ($5::text IS NULL OR workspace_id=$5) AND status='leased' AND lease_expires_at>clock_timestamp() RETURNING *`,values);
  if(!r.rowCount)throw new Error('Work item lease is not owned or has expired.');return this.workRow(r.rows[0]);
 }
 async cancelWork(id:string){
  if(!this.enabled())return undefined;
  const r=await db().query(`UPDATE work_items SET status=CASE WHEN status='recovery_required' OR (status='leased' AND NOT(kind=ANY($4::text[]))) THEN 'recovery_required' ELSE 'cancelled' END,lease_owner=NULL,lease_expires_at=NULL,payload=payload-'__leaseToken',error='Cancellation requested.',updated_at=now() WHERE id=$1 AND instance_id=$2 AND ($3::text IS NULL OR workspace_id=$3) AND status<>'completed' RETURNING *`,[id,iid(),this.workspace(),[...REPLAY_SAFE_WORK_KINDS]]);
  if(!r.rowCount)throw new Error('Work item not found or already completed.');return this.workRow(r.rows[0]);
 }
 async retryWork(id:string,note:string){
  if(!this.enabled())return undefined;
  const r=await db().query(`UPDATE work_items SET status='queued',error=NULL,payload=payload||jsonb_build_object('__recovery',jsonb_build_object('note',$4::text,'at',now())),updated_at=now() WHERE id=$1 AND instance_id=$2 AND ($3::text IS NULL OR workspace_id=$3) AND status='recovery_required' AND attempts<max_attempts RETURNING *`,[id,iid(),this.workspace(),note]);
  if(!r.rowCount)throw new Error('Work item is not recoverable or its retry budget is exhausted.');return this.workRow(r.rows[0]);
 }
 async saveHandoff(h:MissionHandoff){
  const workspaceId=this.workspaceFor(h.workspaceId);if(!this.enabled())return;
  const inserted=await db().query(`INSERT INTO handoffs(id,instance_id,mission_id,alias,body,created_at,workspace_id)
   SELECT $1,$2,m.id,$4,CASE WHEN m.workspace_id IS NULL THEN $5::jsonb-'workspaceId' ELSE $5::jsonb||jsonb_build_object('workspaceId',m.workspace_id) END,$6,m.workspace_id
   FROM missions m WHERE m.id=$3 AND m.instance_id=$2 AND ($7::text IS NULL OR m.workspace_id=$7)
   ON CONFLICT(id) DO NOTHING RETURNING workspace_id`,[h.id,iid(),h.missionId,h.alias??null,JSON.stringify(h),h.createdAt,workspaceId]);
  if(!inserted.rowCount)throw new Error('Handoff mission not found in this workspace or handoff identity already exists.');
  return{workspaceId:inserted.rows[0].workspace_id??undefined};
 }

 async handoffs(missionId:string){if(!this.enabled())return null;const r=await db().query('SELECT body FROM handoffs WHERE instance_id=$1 AND mission_id=$2 AND ($3::text IS NULL OR workspace_id=$3) ORDER BY created_at DESC',[iid(),missionId,this.workspace()]);return r.rows.map((x:any)=>x.body as MissionHandoff)}
}