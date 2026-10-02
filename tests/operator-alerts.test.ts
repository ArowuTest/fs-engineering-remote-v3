import test from 'node:test';
import assert from 'node:assert/strict';
import {evaluateOperatorAlerts,type OperatorAlertInput,type OperatorAlertPolicy} from '../src/operator-alerts.js';

const policy:OperatorAlertPolicy={maxRecoveryRequired:2,maxReconnectsInWindow:4,maxRestartsInWindow:2,maxDatabaseLatencyMs:500};
const healthy=():OperatorAlertInput=>({
 controlPlane:{ready:true,servingRevision:'abc',expectedRevision:'abc',deploymentFailed:false,restartLoop:false},
 database:{healthy:true,latencyMs:20},
 worker:{state:'healthy'},
 queue:{recoveryRequired:0},
 nodes:{byLifecycle:{ready:2,online_unknown:0,blocked:0,offline:0,incompatible:0},reconnectsInWindow:0,restartsInWindow:0},
});

test('ALERT-01 healthy production state emits no alerts',()=>assert.deepEqual(evaluateOperatorAlerts(healthy(),policy),[]));

test('ALERT-02 readiness, database, worker and deployment failures are explicit critical alerts',()=>{
 const input=healthy();input.controlPlane.ready=false;input.database.healthy=false;input.worker.state='stale';input.controlPlane.deploymentFailed=true;
 const codes=evaluateOperatorAlerts(input,policy).map(x=>x.code);
 for(const code of ['control_plane_not_ready','database_unavailable','worker_stale','deployment_failed'])assert.ok(codes.includes(code),code);
 assert.ok(evaluateOperatorAlerts(input,policy).filter(x=>codes.includes(x.code)).every(x=>x.severity==='critical'));
});

test('ALERT-03 thresholds and compatibility/revision conditions are deterministic',()=>{
 const input=healthy();input.queue.recoveryRequired=3;input.nodes.reconnectsInWindow=5;input.nodes.restartsInWindow=3;input.nodes.byLifecycle.incompatible=1;input.controlPlane.servingRevision='old';input.controlPlane.restartLoop=true;input.database.latencyMs=501;
 const codes=evaluateOperatorAlerts(input,policy).map(x=>x.code);
 for(const code of ['recovery_backlog','node_reconnect_storm','node_restart_loop','incompatible_nodes','stale_deployment_revision','railway_restart_loop','database_latency_high'])assert.ok(codes.includes(code),code);
});

test('ALERT-04 equality at explicit thresholds does not alert',()=>{
 const input=healthy();input.queue.recoveryRequired=policy.maxRecoveryRequired;input.nodes.reconnectsInWindow=policy.maxReconnectsInWindow;input.nodes.restartsInWindow=policy.maxRestartsInWindow;input.database.latencyMs=policy.maxDatabaseLatencyMs;
 assert.deepEqual(evaluateOperatorAlerts(input,policy),[]);
});

test('ALERT-05 missing worker is distinct from stale worker and messages are bounded',()=>{
 const input=healthy();input.worker={state:'missing'};const alerts=evaluateOperatorAlerts(input,policy);
 assert.deepEqual(alerts.map(x=>x.code),['worker_missing']);assert.ok(alerts[0].summary.length<240);
});

test('ALERT-06 durable telemetry emits binary alerts without inventing missing thresholds',()=>{
 const alerts=evaluateOperatorAlerts({
  controlPlane:{ready:true,servingRevision:'same',expectedRevision:'same',deploymentFailed:false,restartLoop:false},
  database:{healthy:true,latencyMs:9999},worker:{state:'stale'},queue:{recoveryRequired:99},
  nodes:{byLifecycle:{ready:0,online_unknown:0,blocked:0,offline:0,incompatible:1},reconnectsInWindow:99,restartsInWindow:99},
 },{} as OperatorAlertPolicy);
 assert.deepEqual(alerts.map(x=>x.code),['worker_stale','incompatible_nodes']);
});

test('ALERT-07 unobserved deployment and node-rate signals remain unknown rather than healthy zero',()=>{
 const input=healthy() as any;delete input.controlPlane.deploymentFailed;delete input.controlPlane.restartLoop;delete input.nodes.reconnectsInWindow;delete input.nodes.restartsInWindow;
 const strict={...policy,maxReconnectsInWindow:0,maxRestartsInWindow:0};
 const codes=evaluateOperatorAlerts(input,strict).map(x=>x.code);
 assert.equal(codes.includes('deployment_failed'),false);
 assert.equal(codes.includes('railway_restart_loop'),false);
 assert.equal(codes.includes('node_reconnect_storm'),false);
 assert.equal(codes.includes('node_restart_loop'),false);
});
