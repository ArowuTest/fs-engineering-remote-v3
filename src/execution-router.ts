import {assertOptionalExecutionReleased} from './execution-release.js';import crypto from 'node:crypto';
import {NodeRegistry,type NodeCapability,type ExecutionTarget} from './nodes.js';
import {OpenSandboxProvider} from './sandbox.js';
import {WorkerQueue} from './workers.js';
import {runtimeIdentity} from './runtime.js';
import {AccountingStore} from './accounting-store.js';
export interface ExecutionRequest{missionId:string;stepId:string;nodeId:string;project:string;capability:NodeCapability;operation:string;payload:Record<string,unknown>;executionTarget:ExecutionTarget;workspaceId?:string;idempotencyKey?:string}
export class ExecutionRouter{
 constructor(private nodes?:Pick<NodeRegistry,'enqueue'>,private sandbox=new OpenSandboxProvider()){}
 async dispatch(x:ExecutionRequest){const key=x.idempotencyKey??crypto.createHash('sha256').update(JSON.stringify(x)).digest('hex');
  if(x.executionTarget==='local')return{target:'local',job:await (this.nodes??new NodeRegistry(x.workspaceId)).enqueue({...x,executionTarget:'local'},{idempotencyKey:key})};
  const quota=await new AccountingStore(x.workspaceId).gate();if(!quota.allowed)throw new Error(`WORKSPACE_QUOTA_EXCEEDED: ${quota.failures.join('; ')}`);
  if(x.executionTarget==='sandbox'){const health=await this.sandbox.status();if(!health.configured)throw new Error('OpenSandbox execution was requested but FS_OPENSANDBOX_URL is not configured.');if(!health.healthy)throw new Error(`OpenSandbox execution provider is unhealthy: ${health.reason??'unknown'}`);assertOptionalExecutionReleased('sandbox');const policy=x.payload.sandboxPolicy as any;if(!policy)throw new Error('Sandbox execution requires an explicit sandboxPolicy.');const payload={...x.payload};delete (payload as any).sandboxPolicy;return{target:'sandbox',job:await this.sandbox.execute({missionId:x.missionId,stepId:x.stepId,capability:x.capability,operation:x.operation,payload,policy})};}
  if(x.capability!=='git'||x.operation!=='hosted_apply')throw new Error(`Hosted execution does not support ${x.capability}/${x.operation}.`);assertOptionalExecutionReleased('hosted');const q=new WorkerQueue(runtimeIdentity().stateRoot+'/work-queue',120000,x.workspaceId);return{target:'hosted',job:await q.enqueue({missionId:x.missionId,stepId:x.stepId,kind:'hosted_execution',payload:{...x.payload,project:x.project,capability:x.capability,operation:x.operation,__executionTarget:'hosted',__idempotencyKey:key},maxAttempts:2})};
 }
}
