import crypto from 'node:crypto';
import type {PoolClient} from 'pg';
import {db,databaseEnabled} from './db.js';
import {quotaDecision,type WorkspaceQuota,type WorkspaceUsage,type ExecutionUsage,usageEnvelope} from './accounting.js';

type Queryable=Pick<PoolClient,'query'>;
const defaults=():WorkspaceQuota=>({
 maxConcurrent:Number(process.env.FS_QUOTA_MAX_CONCURRENT??8),
 maxDailyExecutions:Number(process.env.FS_QUOTA_DAILY_EXECUTIONS??500),
 maxDailyEstimatedCostUsd:Number(process.env.FS_QUOTA_DAILY_COST_USD??25),
 maxDailySandboxMinutes:Number(process.env.FS_QUOTA_DAILY_SANDBOX_MINUTES??600),
});

export class AccountingStore{
 constructor(private workspaceId?:string){}
 private queryable(connection?:Queryable){return connection??db()}

 async quota(connection?:Queryable):Promise<WorkspaceQuota>{
  if(!databaseEnabled()||!this.workspaceId)return defaults();
  const r=await this.queryable(connection).query('SELECT max_concurrent,max_daily_executions,max_daily_estimated_cost_usd,max_daily_sandbox_minutes FROM workspace_quotas WHERE workspace_id=$1',[this.workspaceId]);
  if(!r.rowCount)return defaults();
  const x=r.rows[0];return{maxConcurrent:x.max_concurrent,maxDailyExecutions:x.max_daily_executions,maxDailyEstimatedCostUsd:Number(x.max_daily_estimated_cost_usd),maxDailySandboxMinutes:Number(x.max_daily_sandbox_minutes)};
 }

 async usage(connection?:Queryable):Promise<WorkspaceUsage>{
  if(!databaseEnabled()||!this.workspaceId)return{active:0,dailyExecutions:0,dailyEstimatedCostUsd:0,dailySandboxMinutes:0};
  const q=this.queryable(connection);
  const active=await q.query(`
   SELECT
    (SELECT count(*)::int FROM node_jobs WHERE workspace_id=$1 AND status IN ('queued','leased'))+
    (SELECT count(*)::int FROM work_items WHERE workspace_id=$1 AND status IN ('queued','leased') AND kind IN ('hosted_execution','hosted_git')) AS n,
    (SELECT count(*)::int FROM node_jobs WHERE workspace_id=$1 AND status IN ('queued','leased') AND created_at>=date_trunc('day',clock_timestamp()))+
    (SELECT count(*)::int FROM work_items WHERE workspace_id=$1 AND status IN ('queued','leased') AND kind IN ('hosted_execution','hosted_git') AND created_at>=date_trunc('day',clock_timestamp())) AS today
  `,[this.workspaceId]);
  const completed=await q.query(`
   SELECT count(*)::int n,coalesce(sum(estimated_cost_usd),0) cost,
    coalesce(sum(CASE WHEN execution_target='sandbox' THEN wall_clock_ms ELSE 0 END),0)/60000.0 sandbox_minutes
   FROM execution_usage WHERE workspace_id=$1 AND observed_at>=date_trunc('day',clock_timestamp())
  `,[this.workspaceId]);
  return{
   active:Number(active.rows[0].n),
   dailyExecutions:Number(completed.rows[0].n)+Number(active.rows[0].today),
   dailyEstimatedCostUsd:Number(completed.rows[0].cost),
   dailySandboxMinutes:Number(completed.rows[0].sandbox_minutes),
  };
 }

 async gate(connection?:Queryable){return quotaDecision(await this.quota(connection),await this.usage(connection))}

 async lockAdmission(connection:Queryable){
  if(!this.workspaceId)return;
  await connection.query('SELECT pg_advisory_xact_lock(hashtext($1))',['fs-remote:quota:'+this.workspaceId]);
 }

 async record(input:ExecutionUsage,missionId?:string,stepId?:string,connection?:Queryable){
  const e=usageEnvelope(input);
  if(databaseEnabled()&&this.workspaceId)await this.queryable(connection).query(
   'INSERT INTO execution_usage(id,workspace_id,mission_id,step_id,execution_target,wall_clock_ms,cpu_seconds,memory_mb_seconds,input_bytes,output_bytes,estimated_cost_usd,observed_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)',
   ['usage-'+Date.now()+'-'+crypto.randomBytes(6).toString('hex'),this.workspaceId,missionId??null,stepId??null,e.executionTarget,e.wallClockMs,input.cpuSeconds??null,input.memoryMbSeconds??null,e.inputBytes,e.outputBytes,e.estimatedCostUsd,e.observedAt]
  );
  return e;
 }
}
