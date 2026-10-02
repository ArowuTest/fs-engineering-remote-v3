import path from 'node:path';
import type {Evidence} from './missions.js';
import {localRecordId,readLocalObject} from './local-mission-parent.js';

export interface LocalWorkCompletion{
 schemaVersion:'fs-remote.local-work-completion.v1';
 workId:string;
 missionId:string;
 stepId:string;
 workspaceId?:string;
 workerId:string;
 committedAt:string;
 result:Record<string,unknown>;
 evidence:Evidence[];
}
export function localWorkCompletionDir(missionBase:string,missionId:string){return path.join(missionBase,localRecordId(missionId),'work-completions')}
export function localWorkCompletionFile(missionBase:string,missionId:string,workId:string){return path.join(localWorkCompletionDir(missionBase,missionId),localRecordId(workId)+'.json')}
export async function readLocalWorkCompletion(file:string,expectedWorkId?:string):Promise<LocalWorkCompletion|null>{
 const x=await readLocalObject(file,'work completion');if(!x)return null;
 const evidence=(x as any).evidence;
 if(x.schemaVersion!=='fs-remote.local-work-completion.v1'||typeof x.workId!=='string'||(expectedWorkId!==undefined&&x.workId!==expectedWorkId)||typeof x.missionId!=='string'||typeof x.stepId!=='string'||typeof x.workerId!=='string'||typeof x.committedAt!=='string'||(x.workspaceId!==undefined&&typeof x.workspaceId!=='string')||!x.result||typeof x.result!=='object'||Array.isArray(x.result)||!Array.isArray(evidence))throw new Error('Invalid local work completion record.');
 for(const e of evidence)if(!e||typeof e!=='object'||e.schemaVersion!=='fs-remote.evidence.v1'||typeof e.id!=='string'||typeof e.missionId!=='string'||(e.stepId!==undefined&&typeof e.stepId!=='string')||(e.workspaceId!==undefined&&typeof e.workspaceId!=='string')||typeof e.kind!=='string'||typeof e.source!=='string'||!['pass','fail','info','unknown'].includes(e.status)||typeof e.summary!=='string'||typeof e.observedAt!=='string')throw new Error('Invalid local completion evidence record.');
 return x as unknown as LocalWorkCompletion;
}
