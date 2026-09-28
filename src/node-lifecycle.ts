import {evaluateNodeCompatibility,type NodeCompatibility} from './node-compatibility.js';
export type NodeLifecycleState='ready'|'online_unknown'|'blocked'|'offline'|'incompatible';
export interface NodeLifecycle{schemaVersion:'fs.node.lifecycle.v1';state:NodeLifecycleState;connected:boolean;executionAllowed:boolean;claimAllowed:boolean;queueAllowed:boolean;reason:string;compatibility:NodeCompatibility}
export function deriveNodeLifecycle(input:{status?:string;readiness?:{ok?:boolean}|null;agent?:any;compatibility?:NodeCompatibility|null}):NodeLifecycle{
 const compatibility=input.compatibility??evaluateNodeCompatibility(input.agent),connected=input.status==='online';
 if(!compatibility.executionAllowed)return{schemaVersion:'fs.node.lifecycle.v1',state:'incompatible',connected,executionAllowed:false,claimAllowed:false,queueAllowed:false,reason:compatibility.reason,compatibility};
 if(!connected)return{schemaVersion:'fs.node.lifecycle.v1',state:'offline',connected:false,executionAllowed:true,claimAllowed:false,queueAllowed:true,reason:'Node is offline; queued work may wait for reconnect.',compatibility};
 if(input.readiness?.ok===false)return{schemaVersion:'fs.node.lifecycle.v1',state:'blocked',connected:true,executionAllowed:false,claimAllowed:false,queueAllowed:true,reason:'Node is connected but its readiness checks are blocking execution.',compatibility};
 if(input.readiness?.ok===true)return{schemaVersion:'fs.node.lifecycle.v1',state:'ready',connected:true,executionAllowed:true,claimAllowed:true,queueAllowed:true,reason:'Node is connected, compatible, and execution-ready.',compatibility};
 return{schemaVersion:'fs.node.lifecycle.v1',state:'online_unknown',connected:true,executionAllowed:true,claimAllowed:true,queueAllowed:true,reason:'Node is connected and compatible but has not reported readiness; legacy execution remains allowed.',compatibility};
}
