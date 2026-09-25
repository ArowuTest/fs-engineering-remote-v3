import crypto from 'node:crypto';
export interface PayloadBudget{softBytes:number;hardBytes:number;previewBytes:number}
export const DEFAULT_PAYLOAD_BUDGET:PayloadBudget={softBytes:64*1024,hardBytes:256*1024,previewBytes:48*1024};
const bytes=(x:string)=>Buffer.byteLength(x,'utf8');
function clip(s:string,n:number){if(bytes(s)<=n)return s;let x=s.slice(0,n);while(bytes(x)>n)x=x.slice(0,-256);return x}
export function budgetToolPayload(value:unknown,budget=DEFAULT_PAYLOAD_BUDGET){const raw=typeof value==='string'?value:JSON.stringify(value),size=bytes(raw),sha256=crypto.createHash('sha256').update(raw).digest('hex');if(size<=budget.softBytes)return{value,meta:{bytes:size,truncated:false,sha256}};const preview=clip(raw,budget.previewBytes);return{value:{schemaVersion:'fs.payload.preview.v1',truncated:true,originalBytes:size,sha256,preview,reason:size>budget.hardBytes?'hard_payload_limit':'soft_payload_limit',guidance:'Request a narrower range, smaller limit, later execution cursor, or specific artifact instead of retransmitting the complete payload.'},meta:{bytes:size,truncated:true,sha256}}}
export function estimateJsonBytes(value:unknown){return bytes(typeof value==='string'?value:JSON.stringify(value))}
