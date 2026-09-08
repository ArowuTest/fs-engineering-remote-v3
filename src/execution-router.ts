import crypto from 'node:crypto';
import {NodeRegistry,type NodeCapability,type ExecutionTarget} from './nodes.js';
import {OpenSandboxProvider} from './sandbox.js';
import {WorkerQueue} from './workers.js';
import {runtimeIdentity} from './runtime.js';
export interface ExecutionRequest{missionId:string;stepId:string;nodeId:string;project:string;capability:NodeCapability;operation:string;payload:Record<string,unknown>;executionTarget:ExecutionTarget;workspaceId?:string;idempotencyKey?:string}
export class ExecutionRouter{
 constructor(private nodes=new NodeRegistry(),private sandbox=new OpenSandboxProvider()){}
 async dispatch(x:ExecutionRequest){const key=x.idempotencyKey??crypto.createHash('sha256').update(JSON.stringify(x)).digest('hex');
  if(x.executionTarget==='local')return{target:'local',job:await this.nodes.enqueue({...x,executionTarget:'local'},{idempotencyKey:key})};
  if(x.executionTarget==='sandbox'){const health=await this.sandbox.status();if(!health.configured)throw new Error('OpenSandbox execution was requested but FS_OPENSANDBOX_URL is not configured.');if(!health.healthy)throw new Error(`OpenSandbox execution provider is unhealthy: ${health.reason??'unknown'}`);throw new Error('OpenSandbox execution is configured but repository/materialization policy is not yet enabled.');}
  const allowed=new Set(['engineering','command','git']);if(!allowed.has(x.capability))throw new Error(`Hosted execution does not support ${x.capability}/${x.operation}.`);const q=new WorkerQueue(runtimeIdentity().stateRoot+'/hosted-routing',120000,x.workspaceId);return{target:'hosted',job:await q.enqueue({missionId:x.missionId,stepId:x.stepId,kind:'hosted_execution',payload:{...x.payload,project:x.project,capability:x.capability,operation:x.operation,__executionTarget:'hosted',__idempotencyKey:key},maxAttempts:2})};
 }
}
