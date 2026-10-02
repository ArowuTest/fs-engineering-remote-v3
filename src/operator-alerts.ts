export type OperatorAlertSeverity='warning'|'high'|'critical';
export interface OperatorAlert{code:string;severity:OperatorAlertSeverity;summary:string}
export interface OperatorAlertPolicy{maxRecoveryRequired:number;maxReconnectsInWindow:number;maxRestartsInWindow:number;maxDatabaseLatencyMs:number}
export interface OperatorAlertInput{
 controlPlane:{ready?:boolean;servingRevision?:string|null;expectedRevision?:string|null;deploymentFailed?:boolean;restartLoop?:boolean};
 database:{healthy:boolean;latencyMs?:number|null};
 worker:{state:'healthy'|'stale'|'missing'};
 queue:{recoveryRequired:number};
 nodes:{byLifecycle:Record<string,number>;reconnectsInWindow?:number;restartsInWindow?:number};
}
const push=(out:OperatorAlert[],code:string,severity:OperatorAlertSeverity,summary:string)=>out.push({code,severity,summary});
export function evaluateOperatorAlerts(input:OperatorAlertInput,policy:OperatorAlertPolicy):OperatorAlert[]{
 const out:OperatorAlert[]=[];
 if(input.controlPlane.ready===false)push(out,'control_plane_not_ready','critical','Control-plane readiness is failing.');
 if(!input.database.healthy)push(out,'database_unavailable','critical','The durable database is unavailable.');
 if(input.worker.state==='missing')push(out,'worker_missing','critical','No autonomous-worker heartbeat is recorded.');
 else if(input.worker.state==='stale')push(out,'worker_stale','critical','The autonomous-worker heartbeat is stale.');
 if(input.controlPlane.deploymentFailed===true)push(out,'deployment_failed','critical','The current deployment is reported failed.');
 if(input.controlPlane.restartLoop===true)push(out,'railway_restart_loop','high','The service is in a restart loop.');
 if(input.queue.recoveryRequired>policy.maxRecoveryRequired)push(out,'recovery_backlog','high',`Recovery-required work exceeds the configured threshold (${input.queue.recoveryRequired} > ${policy.maxRecoveryRequired}).`);
 if(Number.isFinite(input.nodes.reconnectsInWindow)&&Number(input.nodes.reconnectsInWindow)>policy.maxReconnectsInWindow)push(out,'node_reconnect_storm','high',`Node reconnects exceed the configured threshold (${input.nodes.reconnectsInWindow} > ${policy.maxReconnectsInWindow}).`);
 if(Number.isFinite(input.nodes.restartsInWindow)&&Number(input.nodes.restartsInWindow)>policy.maxRestartsInWindow)push(out,'node_restart_loop','high',`Node restarts exceed the configured threshold (${input.nodes.restartsInWindow} > ${policy.maxRestartsInWindow}).`);
 if((input.nodes.byLifecycle.incompatible??0)>0)push(out,'incompatible_nodes','high','One or more execution nodes are protocol-incompatible.');
 const serving=input.controlPlane.servingRevision?.trim(),expected=input.controlPlane.expectedRevision?.trim();
 if(serving&&expected&&serving!==expected)push(out,'stale_deployment_revision','high','The serving revision does not match the expected deployment revision.');
 if(input.database.healthy&&Number.isFinite(input.database.latencyMs)&&Number(input.database.latencyMs)>policy.maxDatabaseLatencyMs)push(out,'database_latency_high','warning',`Database latency exceeds the configured threshold (${Math.round(Number(input.database.latencyMs))}ms > ${policy.maxDatabaseLatencyMs}ms).`);
 return out;
}
