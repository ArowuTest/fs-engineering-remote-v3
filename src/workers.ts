import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import {AccountingStore} from './accounting-store.js';
import type {ExecutionUsage} from './accounting.js';
import {assertLeaseDuration} from './lease-duration.js';
import {localMissionParent,readLocalObject,assertLocalRecordParent,LocalWorkspaceAccessDenied} from './local-mission-parent.js';
import {atomicWriteJson,withLocalStateLock} from './local-state-io.js';
import {localWorkCompletionFile,readLocalWorkCompletion,type LocalWorkCompletion} from './local-work-completion.js';
import type {MissionManager,Evidence} from './missions.js';
import {PgStateStore} from './pg-state.js';
import {workerReplaySafe} from './worker-retry-policy.js';

export type WorkStatus='queued'|'leased'|'completed'|'failed'|'cancelled'|'recovery_required';
export interface WorkItem{
 schemaVersion:'fs-remote.work-item.v1';
 id:string;
 workspaceId?:string;
 missionId:string;
 stepId:string;
 kind:string;
 payload:Record<string,unknown>;
 status:WorkStatus;
 createdAt:string;
 updatedAt:string;
 attempts:number;
 maxAttempts:number;
 lease?:{workerId:string;token:string;leasedAt:string;heartbeatAt:string;expiresAt:string};
 result?:Record<string,unknown>;
 error?:string;
}

export class WorkerQueue{
 private readonly pg:PgStateStore;
 constructor(
  private readonly base:string,
  private readonly defaultLeaseMs=120000,
  private readonly workspaceId?:string,
  private readonly missionBase=path.join(path.dirname(base),'missions')
 ){this.pg=new PgStateStore(workspaceId)}

 private file(id:string){if(!/^[A-Za-z0-9._-]+$/.test(id))throw new Error('Invalid work item id.');return path.join(this.base,`${id}.json`)}
 private lockDir(){return path.join(this.base,'.fs-worker-queue.lock')}
 private workClaimLockDir(id:string){return path.join(this.base,'.fs-worker-claim-locks',id+'.lock')}
 private async localMutation<T>(run:()=>Promise<T>){return withLocalStateLock(this.lockDir(),run)}
 private async saveLocal(w:WorkItem){w.updatedAt=new Date().toISOString();await atomicWriteJson(this.file(w.id),w);return w}
 private async save(w:WorkItem){if(this.pg.enabled()){await this.pg.saveWork(w);return w}return this.localMutation(()=>this.saveLocal(w))}

 private async localBase(id:string){
  const local=await readLocalObject(this.file(id),'work');
  if(!local||local.schemaVersion!=='fs-remote.work-item.v1'||local.id!==id||typeof local.missionId!=='string'||typeof local.stepId!=='string'||!local.stepId)throw new Error('Invalid local work identity or parent fields.');
  if(this.workspaceId!==undefined&&local.workspaceId!==this.workspaceId)throw new LocalWorkspaceAccessDenied();
  const parent=await localMissionParent(this.missionBase,local.missionId,this.workspaceId,local.stepId);
  assertLocalRecordParent(local,parent);
  return local as unknown as WorkItem;
 }
 private async completedView(local:WorkItem){
  const completion=await readLocalWorkCompletion(localWorkCompletionFile(this.missionBase,local.missionId,local.id),local.id);
  if(!completion)return local;
  if(completion.missionId!==local.missionId||completion.stepId!==local.stepId||completion.workspaceId!==local.workspaceId)throw new Error('Local work completion parent identity mismatch.');
  const parent=await localMissionParent(this.missionBase,local.missionId,this.workspaceId,local.stepId);assertLocalRecordParent(completion,parent);
  return {...local,status:'completed' as const,result:completion.result,lease:undefined,error:undefined,updatedAt:completion.committedAt};
 }
 private async getLocal(id:string){return this.completedView(await this.localBase(id))}
 private async listLocal(){
  let names:string[];try{names=(await fs.readdir(this.base)).filter(x=>x.endsWith('.json'))}catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return [];throw error}
  const out:WorkItem[]=[];for(const name of names){try{out.push(await this.getLocal(name.slice(0,-5)))}catch(error){if(!(error instanceof LocalWorkspaceAccessDenied))throw error}}
  return out.sort((a,b)=>a.createdAt.localeCompare(b.createdAt));
 }

 async enqueue(input:{missionId:string;stepId:string;kind:string;payload?:Record<string,unknown>;maxAttempts?:number}){
  const now=new Date().toISOString(),w:WorkItem={schemaVersion:'fs-remote.work-item.v1',workspaceId:this.workspaceId,id:`work-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`,missionId:input.missionId,stepId:input.stepId,kind:input.kind,payload:input.payload??{},status:'queued',createdAt:now,updatedAt:now,attempts:0,maxAttempts:input.maxAttempts??3};
  if(this.pg.enabled())return this.pg.enqueueWork(w);
  const parent=await localMissionParent(this.missionBase,w.missionId,this.workspaceId,w.stepId);w.workspaceId=parent.workspaceId;
  return this.localMutation(()=>this.saveLocal(w));
 }
 async get(id:string){const p=await this.pg.getWork(id);if(p)return p;if(this.pg.enabled())throw new Error('Work item not found in this workspace.');return this.getLocal(id)}
 async list(){const p=await this.pg.listWork();if(p)return p;return this.listLocal()}

 private async recoverLocal(){
  const now=Date.now(),items=await this.listLocal();let recovered=0,failed=0,recoveryRequired=0;
  for(const w of items){
   if(w.status!=='leased'||!w.lease||Date.parse(w.lease.expiresAt)>now)continue;
   w.lease=undefined;delete w.payload.__leaseToken;
   if(!workerReplaySafe(w.kind)){w.status='recovery_required';w.error='Worker lease expired; inspect side effects before explicit retry.';recoveryRequired++}
   else if(w.attempts>=w.maxAttempts){w.status='failed';w.error='Worker lease expired and retry budget exhausted.';failed++}
   else{w.status='queued';w.error='Previous worker lease expired; replay-safe item recovered for retry.';recovered++}
   await this.saveLocal(w);
  }
  return{recovered,failed,recoveryRequired};
 }
 async recover(){const durable=await this.pg.recoverWork();if(durable!==undefined)return durable;return this.localMutation(()=>this.recoverLocal())}

 async claim(workerId:string,kinds:string[]=[],leaseMs=this.defaultLeaseMs){
  if(!/^[A-Za-z0-9._-]+$/.test(workerId))throw new Error('Invalid workerId.');assertLeaseDuration(leaseMs);
  if(this.pg.enabled()){await this.pg.recoverWork();const claimed=await this.pg.claim(workerId,kinds,leaseMs);if(claimed!==undefined)return claimed;}
  return this.localMutation(async()=>{
   const items=await this.listLocal(),candidate=items.find(x=>x.status==='queued'&&(!kinds.length||kinds.includes(x.kind)));if(!candidate)return null;
   return withLocalStateLock(this.workClaimLockDir(candidate.id),async()=>{
    const w=await this.localBase(candidate.id);
    if(w.status!=='queued'||(kinds.length&&!kinds.includes(w.kind)))return null;
    const now=new Date(),token=crypto.randomBytes(24).toString('hex');w.status='leased';w.attempts++;w.lease={workerId,token,leasedAt:now.toISOString(),heartbeatAt:now.toISOString(),expiresAt:new Date(now.getTime()+leaseMs).toISOString()};
    return this.saveLocal(w);
   });
  });
 }
 private async ownedLocal(id:string,workerId:string,token:string){
  const w=await this.getLocal(id);if(w.status!=='leased'||!w.lease||w.lease.workerId!==workerId||w.lease.token!==token)throw new Error('Work item lease is not owned by this worker.');if(Date.parse(w.lease.expiresAt)<Date.now())throw new Error('Work item lease has expired.');return w;
 }
 async heartbeat(id:string,workerId:string,token:string,leaseMs=this.defaultLeaseMs){
  assertLeaseDuration(leaseMs);const durable=await this.pg.updateOwnedWork(id,workerId,token,'heartbeat',{leaseMs});if(durable)return durable;
  return this.localMutation(async()=>{const w=await this.ownedLocal(id,workerId,token),now=new Date();w.lease!.heartbeatAt=now.toISOString();w.lease!.expiresAt=new Date(now.getTime()+leaseMs).toISOString();return this.saveLocal(w)});
 }
 async complete(id:string,workerId:string,token:string,result:Record<string,unknown>={}){
  const durable=await this.pg.updateOwnedWork(id,workerId,token,'complete',{result});if(durable)return durable;
  return this.localMutation(async()=>{const w=await this.ownedLocal(id,workerId,token);w.status='completed';w.result=result;w.lease=undefined;w.error=undefined;return this.saveLocal(w)});
 }
 async fail(id:string,workerId:string,token:string,error:string,retry=true){
  const durable=await this.pg.updateOwnedWork(id,workerId,token,'fail',{error,retry});if(durable)return durable;
  return this.localMutation(async()=>{const w=await this.ownedLocal(id,workerId,token);w.lease=undefined;w.error=error;if(!workerReplaySafe(w.kind))w.status='recovery_required';else if(retry&&w.attempts<w.maxAttempts)w.status='queued';else w.status='failed';return this.saveLocal(w)});
 }
 async cancel(id:string){
  const durable=await this.pg.cancelWork(id);if(durable)return durable;
  return this.localMutation(async()=>{const w=await this.getLocal(id);if(w.status==='completed')throw new Error('Completed work cannot be cancelled.');w.status=(w.status==='recovery_required'||w.status==='leased'&&!workerReplaySafe(w.kind))?'recovery_required':'cancelled';w.lease=undefined;return this.saveLocal(w)});
 }

 async completeWithEvidence(missions:MissionManager,id:string,workerId:string,token:string,result:Record<string,unknown>,evidence:Array<{kind:string;source:string;status:'pass'|'fail'|'info'|'unknown';summary:string;data?:Record<string,unknown>}>,usage:ExecutionUsage){
  const durable=await this.pg.completeWorkWithEvidence(id,workerId,token,result,evidence,usage);if(durable)return durable;
  return this.localMutation(async()=>{
   const owned=await this.ownedLocal(id,workerId,token);
   const accounted=await new AccountingStore(owned.workspaceId).record(usage,owned.missionId,owned.stepId),committedAt=new Date().toISOString();
   const records:Evidence[]=evidence.map(e=>({schemaVersion:'fs-remote.evidence.v1',id:`evidence-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`,workspaceId:owned.workspaceId,missionId:owned.missionId,stepId:owned.stepId,observedAt:committedAt,...e,data:{...(e.data??{}),executionId:owned.id}}));
   const envelope={schemaVersion:'fs-remote.execution-result.v1',executionId:owned.id,executionTarget:usage.executionTarget,completedAt:committedAt,usage:accounted,result};
   const transaction:LocalWorkCompletion={schemaVersion:'fs-remote.local-work-completion.v1',workId:owned.id,workspaceId:owned.workspaceId,missionId:owned.missionId,stepId:owned.stepId,workerId,committedAt,result:envelope,evidence:records};
   await atomicWriteJson(localWorkCompletionFile(this.missionBase,owned.missionId,owned.id),transaction);
   owned.status='completed';owned.result=envelope;owned.lease=undefined;owned.error=undefined;
   try{return await this.saveLocal(owned)}catch{return this.getLocal(id)}
  });
 }
 async retry(id:string,note:string){
  if(!note.trim())throw new Error('Explicit inspected recovery requires a note.');const durable=await this.pg.retryWork(id,note);if(durable)return durable;
  return this.localMutation(async()=>{const w=await this.getLocal(id);if(w.status!=='recovery_required'||w.attempts>=w.maxAttempts)throw new Error('Work item is not recoverable or retry budget is exhausted.');w.status='queued';w.error=undefined;w.payload={...w.payload,__recovery:{note,at:new Date().toISOString()}};return this.saveLocal(w)});
 }
 async status(){const items=await this.list();return{total:items.length,queued:items.filter(x=>x.status==='queued').length,leased:items.filter(x=>x.status==='leased').length,completed:items.filter(x=>x.status==='completed').length,failed:items.filter(x=>x.status==='failed').length,cancelled:items.filter(x=>x.status==='cancelled').length,recoveryRequired:items.filter(x=>x.status==='recovery_required').length}}
}
