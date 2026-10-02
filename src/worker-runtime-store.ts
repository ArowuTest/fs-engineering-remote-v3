import {db,databaseEnabled} from './db.js';
import {deriveNodeLifecycle} from './node-lifecycle.js';

const iid=()=>process.env.FS_REMOTE_INSTANCE_ID??'v3-default';
const cleanRole=(role:string)=>{if(!/^[A-Za-z0-9._-]{1,120}$/.test(role))throw new Error('Invalid worker role.');return role};

export interface WorkerRuntimeStart{sessionId:string;workerId:string;serviceVersion:string;deploymentRevision?:string;metadata?:Record<string,unknown>}
export interface WorkerRuntimeSnapshot{role:string;sessionId:string;workerId:string;serviceVersion:string;deploymentRevision:string|null;startedAt:string;lastHeartbeatAt:string;restartCount:number;heartbeatAgeMs:number;state:'healthy'|'stale'}

function runtimeView(row:any,staleAfterMs:number):WorkerRuntimeSnapshot{
 const last=new Date(row.last_heartbeat_at).getTime(),age=Math.max(0,Date.now()-last);
 return{role:String(row.role),sessionId:String(row.session_id),workerId:String(row.worker_id),serviceVersion:String(row.service_version),deploymentRevision:row.deployment_revision?String(row.deployment_revision):null,startedAt:new Date(row.started_at).toISOString(),lastHeartbeatAt:new Date(row.last_heartbeat_at).toISOString(),restartCount:Number(row.restart_count??0),heartbeatAgeMs:age,state:age>staleAfterMs?'stale':'healthy'};
}

export class WorkerRuntimeStore{
 private readonly role:string;
 constructor(role='autonomous-worker'){this.role=cleanRole(role)}
 async start(input:WorkerRuntimeStart,staleAfterMs=30000){
  if(!databaseEnabled())throw new Error('Worker runtime telemetry requires DATABASE_URL.');
  if(!input.sessionId||!input.workerId||!input.serviceVersion)throw new Error('Worker runtime identity is incomplete.');
  const r=await db().query(`INSERT INTO worker_runtime_status(instance_id,role,session_id,worker_id,service_version,deployment_revision,started_at,last_heartbeat_at,restart_count,metadata)
   VALUES($1,$2,$3,$4,$5,$6,clock_timestamp(),clock_timestamp(),0,$7::jsonb)
   ON CONFLICT(instance_id,role) DO UPDATE SET
    restart_count=worker_runtime_status.restart_count+CASE WHEN worker_runtime_status.session_id<>EXCLUDED.session_id THEN 1 ELSE 0 END,
    started_at=CASE WHEN worker_runtime_status.session_id<>EXCLUDED.session_id THEN EXCLUDED.started_at ELSE worker_runtime_status.started_at END,
    session_id=EXCLUDED.session_id,worker_id=EXCLUDED.worker_id,service_version=EXCLUDED.service_version,deployment_revision=EXCLUDED.deployment_revision,
    last_heartbeat_at=clock_timestamp(),metadata=EXCLUDED.metadata
   RETURNING *`,[iid(),this.role,input.sessionId,input.workerId,input.serviceVersion,input.deploymentRevision??null,JSON.stringify(input.metadata??{})]);
  return runtimeView(r.rows[0],staleAfterMs);
 }
 async heartbeat(sessionId:string,workerId:string){
  if(!databaseEnabled())return false;
  const r=await db().query(`UPDATE worker_runtime_status SET last_heartbeat_at=clock_timestamp() WHERE instance_id=$1 AND role=$2 AND session_id=$3 AND worker_id=$4 RETURNING role`,[iid(),this.role,sessionId,workerId]);
  return (r.rowCount??0)>0;
 }
 async snapshot(staleAfterMs=30000):Promise<WorkerRuntimeSnapshot|null>{
  if(!databaseEnabled())return null;
  const r=await db().query('SELECT * FROM worker_runtime_status WHERE instance_id=$1 AND role=$2',[iid(),this.role]);
  return r.rows[0]?runtimeView(r.rows[0],staleAfterMs):null;
 }
}

const counts=(rows:any[])=>{const out:Record<string,number>={queued:0,leased:0,completed:0,failed:0,cancelled:0,recovery_required:0};for(const row of rows)out[String(row.status)]=Number(row.n);return out};
export class ProductionOperatorTelemetry{
 constructor(private readonly workspaceId?:string,private readonly workerRole='autonomous-worker'){}
 async snapshot(){
  if(!databaseEnabled())throw new Error('Production operator telemetry requires DATABASE_URL.');
  const started=performance.now();await db().query('SELECT 1');const latencyMs=Math.max(0,performance.now()-started);
  const workspace=this.workspaceId??null;
  const [work,nodeJobs,lease,lastSuccess,nodeRows]=await Promise.all([
   db().query(`SELECT status,count(*)::int n FROM work_items WHERE instance_id=$1 AND ($2::text IS NULL OR workspace_id=$2) GROUP BY status`,[iid(),workspace]),
   db().query(`SELECT status,count(*)::int n FROM node_jobs WHERE instance_id=$1 AND ($2::text IS NULL OR workspace_id=$2) GROUP BY status`,[iid(),workspace]),
   db().query(`SELECT
    (SELECT count(*)::int FROM work_items WHERE instance_id=$1 AND ($2::text IS NULL OR workspace_id=$2) AND status='leased' AND lease_expires_at<=clock_timestamp()+interval '30 seconds')+
    (SELECT count(*)::int FROM node_jobs WHERE instance_id=$1 AND ($2::text IS NULL OR workspace_id=$2) AND status='leased' AND lease_expires_at<=clock_timestamp()+interval '30 seconds') AS n`,[iid(),workspace]),
   db().query(`SELECT max(at) AS at FROM (
    SELECT updated_at AS at FROM work_items WHERE instance_id=$1 AND ($2::text IS NULL OR workspace_id=$2) AND status='completed'
    UNION ALL SELECT completed_at AS at FROM node_jobs WHERE instance_id=$1 AND ($2::text IS NULL OR workspace_id=$2) AND status='completed'
   ) completed`,[iid(),workspace]),
   db().query(`SELECT id,status,metadata->'readiness' AS readiness,metadata->'agent' AS agent,metadata->'compatibility' AS compatibility FROM execution_nodes WHERE instance_id=$1 AND ($2::text IS NULL OR workspace_id=$2)`,[iid(),workspace])
  ]);
  const workItems=counts(work.rows),nodeJobCounts=counts(nodeJobs.rows),byLifecycle:Record<string,number>={ready:0,online_unknown:0,blocked:0,offline:0,incompatible:0};
  for(const row of nodeRows.rows){const lifecycle=deriveNodeLifecycle({status:row.status,readiness:row.readiness,agent:row.agent,compatibility:row.compatibility});byLifecycle[lifecycle.state]=(byLifecycle[lifecycle.state]??0)+1}
  const worker=await new WorkerRuntimeStore(this.workerRole).snapshot(Number(process.env.FS_REMOTE_WORKER_STALE_MS??30000));
  return{schemaVersion:'fs-remote.production-operator-telemetry.v1',observedAt:new Date().toISOString(),workspaceId:this.workspaceId??null,worker:worker??{role:this.workerRole,state:'missing' as const},database:{healthy:true,latencyMs},queue:{workItems,nodeJobs:nodeJobCounts,recoveryRequired:(workItems.recovery_required??0)+(nodeJobCounts.recovery_required??0),leasesExpiringSoon:Number(lease.rows[0]?.n??0),lastSuccessfulWorkAt:lastSuccess.rows[0]?.at?new Date(lastSuccess.rows[0].at).toISOString():null},nodes:{total:nodeRows.rowCount??0,byLifecycle}};
 }
}
