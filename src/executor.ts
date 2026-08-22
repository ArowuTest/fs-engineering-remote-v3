import { WorkerQueue, type WorkItem } from './workers.js';import { MissionManager } from './missions.js';import type { RuntimeIdentity } from './runtime.js';import { executorId } from './runtime.js';
export type WorkHandler=(item:WorkItem,ctx:{identity:RuntimeIdentity;signal:AbortSignal})=>Promise<{result?:Record<string,unknown>;evidence?:Array<{kind:string;source:string;status:'pass'|'fail'|'info'|'unknown';summary:string;data?:Record<string,unknown>}>}>;
export class PersistentExecutor{
 private running=false;private timer?:NodeJS.Timeout;private readonly workerId:string;private readonly handlers=new Map<string,WorkHandler>();
 constructor(private readonly identity:RuntimeIdentity,private readonly queue:WorkerQueue,private readonly missions:MissionManager,private readonly pollMs=2000,private readonly leaseMs=120000){this.workerId=executorId(identity)}
 register(kind:string,handler:WorkHandler){this.handlers.set(kind,handler);return this}
 capabilities(){return {workerId:this.workerId,instanceId:this.identity.instanceId,running:this.running,pollMs:this.pollMs,leaseMs:this.leaseMs,kinds:[...this.handlers.keys()]}}
 async start(){if(this.running)return this.capabilities();this.running=true;await this.queue.recover();this.schedule(0);return this.capabilities()}
 async stop(){this.running=false;if(this.timer)clearTimeout(this.timer);return this.capabilities()}
 private schedule(ms=this.pollMs){if(this.running)this.timer=setTimeout(()=>void this.tick(),ms)}
 async tick(){if(!this.running)return;try{const kinds=[...this.handlers.keys()];if(!kinds.length)return this.schedule();const item=await this.queue.claim(this.workerId,kinds,this.leaseMs);if(!item)return this.schedule();await this.execute(item)}catch{}finally{this.schedule()}}
 private async execute(item:WorkItem){const handler=this.handlers.get(item.kind);if(!handler)return;const token=item.lease!.token,controller=new AbortController();const heartbeat=setInterval(()=>void this.queue.heartbeat(item.id,this.workerId,token,this.leaseMs).catch(()=>controller.abort()),Math.max(1000,Math.floor(this.leaseMs/3)));try{const out=await handler(item,{identity:this.identity,signal:controller.signal});for(const e of out.evidence??[])await this.missions.addEvidence({missionId:item.missionId,stepId:item.stepId,...e});await this.queue.complete(item.id,this.workerId,token,out.result??{});}catch(error){await this.queue.fail(item.id,this.workerId,token,error instanceof Error?error.message:String(error),true).catch(()=>{});}finally{clearInterval(heartbeat)}}
}
