import path from 'node:path';import {runtimeIdentity} from './runtime.js';import {WorkerQueue} from './workers.js';import {MissionManager} from './missions.js';import {PersistentExecutor} from './executor.js';
const identity=runtimeIdentity(),queue=new WorkerQueue(path.join(identity.stateRoot,'work-queue')),missions=new MissionManager(path.join(identity.stateRoot,'missions'));
const executor=new PersistentExecutor(identity,queue,missions,Number(process.env.FS_REMOTE_WORKER_POLL_MS??2000),Number(process.env.FS_REMOTE_WORKER_LEASE_MS??120000));
// The persistent service owns scheduling/leases. AI reasoning and privileged engineering actions are registered as explicit handlers rather than silently executing arbitrary queue payloads.
executor.register('evidence',async item=>({result:{recorded:true},evidence:[{kind:String(item.payload.kind??'worker'),source:String(item.payload.source??'persistent-executor'),status:(['pass','fail','info','unknown'].includes(String(item.payload.status))?String(item.payload.status):'info') as 'pass'|'fail'|'info'|'unknown',summary:String(item.payload.summary??'Evidence worker completed.'),data:{instanceId:identity.instanceId,workId:item.id}}]}));
await executor.start();console.log(`[fs-remote-worker] instance=${identity.instanceId} worker=${executor.capabilities().workerId} state=${identity.stateRoot}`);
const stop=async()=>{await executor.stop();process.exit(0)};process.on('SIGINT',()=>void stop());process.on('SIGTERM',()=>void stop());
await new Promise(()=>{});
