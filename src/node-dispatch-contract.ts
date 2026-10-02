import crypto from 'node:crypto';
const hash=(value:string)=>crypto.createHash('sha256').update(value).digest('hex');
function canonical(value:any):any{if(Array.isArray(value))return value.map(canonical);if(value&&typeof value==='object')return Object.fromEntries(Object.keys(value).sort().map(k=>[k,canonical(value[k])]));return value}
export function nodeIdempotencyKey(instance:string,workspace:string|null,key:string){return'node-idem-v2:'+hash(JSON.stringify([instance,workspace,key]))}
export function nodeRequestFingerprint(input:{nodeId:string;missionId:string;stepId:string;project:string;capability:string;operation:string;payload:Record<string,unknown>;executionTarget?:string}){
 const {__executionTarget,__retryPolicy,__retryReason,__requestFingerprint,...payload}=input.payload;
 return hash(JSON.stringify(canonical({nodeId:input.nodeId,missionId:input.missionId,stepId:input.stepId,project:input.project,capability:input.capability,operation:input.operation,payload,executionTarget:input.executionTarget??'local'})));
}
