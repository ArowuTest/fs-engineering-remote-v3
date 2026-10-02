import fs from 'node:fs/promises';
import path from 'node:path';
import type {Mission} from './missions.js';

export class LocalWorkspaceAccessDenied extends Error {
  constructor(){super('Cross-workspace access denied.');}
}

export function localRecordId(id:string):string {
  if(typeof id!=='string'||id==='.'||id==='..'||!/^[A-Za-z0-9._-]+$/.test(id))throw new Error('Invalid local mission/work identifier.');
  return id;
}

/** Only absence is optional. Corruption and I/O errors must not become empty state. */
export async function readLocalObject(file:string,label:string):Promise<Record<string,unknown>|null> {
  let text:string;
  try{text=await fs.readFile(file,'utf8');}
  catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return null;throw new Error(`Unable to read local ${label} record.`);}
  try{
    const value:unknown=JSON.parse(text);
    if(!value||typeof value!=='object'||Array.isArray(value))throw new Error();
    return value as Record<string,unknown>;
  }catch{throw new Error(`Corrupt local ${label} record.`);}
}

/** The mission directory is authoritative; caller payloads cannot assign ownership. */
export async function localMissionParent(base:string,id:string,workspaceId?:string,stepId?:string):Promise<Mission> {
  const record=await readLocalObject(path.join(base,localRecordId(id),'mission.json'),'mission');
  if(!record)throw new Error('Local parent mission not found.');
  if(record.schemaVersion!=='fs-remote.mission.v1'||record.id!==id||!Array.isArray(record.steps)||
     (record.workspaceId!==undefined&&typeof record.workspaceId!=='string'))throw new Error('Invalid local mission identity or structure.');
  const stepIds=new Set<string>();
  for(const step of record.steps){if(!step||typeof step!=='object'||typeof step.id!=='string'||!step.id||stepIds.has(step.id))throw new Error('Invalid local mission identity or structure.');stepIds.add(step.id);}
  if(workspaceId!==undefined&&record.workspaceId!==workspaceId)throw new LocalWorkspaceAccessDenied();
  if(stepId!==undefined&&!record.steps.some((step:unknown)=>step!==null&&typeof step==='object'&&(step as {id?:unknown}).id===stepId))throw new Error('Local parent mission step not found.');
  return record as unknown as Mission;
}

export function assertLocalRecordParent(record:{missionId?:unknown;workspaceId?:unknown;stepId?:unknown},mission:Mission):void {
  if(record.missionId===mission.id&&record.workspaceId===undefined&&mission.workspaceId!==undefined)throw new Error('LOCAL_STATE_RECONCILIATION_REQUIRED: unassigned legacy history must be inspected before workspace attribution.');
  if(record.missionId!==mission.id||record.workspaceId!==mission.workspaceId)throw new Error('Local record parent mission/workspace identity mismatch.');
  if(record.stepId!==undefined&&!mission.steps.some(step=>step.id===record.stepId))throw new Error('Local record parent mission step mismatch.');
}
