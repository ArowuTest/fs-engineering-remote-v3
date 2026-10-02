import crypto from 'node:crypto';
import type {Finding} from './finding-verification.js';
export type AdjudicationStatus='CONFIRMED'|'PARTIALLY_VALID'|'REJECTED'|'INSUFFICIENT_EVIDENCE';
// Accept one JSON object, optionally inside a single code fence. Never pick one
// approval object out of ambiguous prose or multiple objects.
export function parseCouncilJson(raw:string):any{
 const text=raw.trim(),fenced=/^```(?:json)?\s*\n?([\s\S]*?)\n?```$/i.exec(text);
 const value=JSON.parse(fenced?fenced[1]:text);
 if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('Council response must be one JSON object.');
 return value;
}
export function assertReviewPayloadSafe(text:string){
 // Defense in depth, not a guarantee of exhaustive PII/secret classification.
 // Refuse known credential forms without echoing the match or silently changing reviewed code.
 if(/(?:sk-or-v1-|ghp_|github_pat_)[A-Za-z0-9_\-]{24,}|-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/.test(text))throw new Error('COUNCIL_SENSITIVE_PAYLOAD: credential-shaped material requires removal before external review.');
}
export function uniqueFindingIds(findings:Finding[]):Finding[]{
 const used=new Set<string>();return findings.map((f,i)=>{
  let id=f.id||'finding';if(used.has(id))id=`${id}:${crypto.createHash('sha256').update(JSON.stringify({role:f.role,location:f.location,claim:f.claim,evidence:f.evidence,i})).digest('hex').slice(0,16)}`;
  while(used.has(id))id+=':'+i;used.add(id);return{...f,id};
 });
}
export function adjudicationStatuses(decision:any,findings:Finding[],failedDimensions:string[]):Map<string,AdjudicationStatus>{
 const statuses=new Map<string,AdjudicationStatus>(),expected=new Set(findings.map(f=>f.id));
 if(!decision||!['approve','changes','block'].includes(decision.verdict)||typeof decision.summary!=='string'||!decision.summary.trim()||!Array.isArray(decision.findings)){
  failedDimensions.push('adjudication:invalid_response');return statuses;
 }
 for(const row of decision.findings){
  const id=typeof row?.id==='string'?row.id:'';
  if(!expected.has(id)){failedDimensions.push('adjudication:unknown_finding');continue}
  if(statuses.has(id)){statuses.set(id,'INSUFFICIENT_EVIDENCE');failedDimensions.push('adjudication:duplicate_finding_id');continue}
  const status:AdjudicationStatus=['CONFIRMED','PARTIALLY_VALID','REJECTED','INSUFFICIENT_EVIDENCE'].includes(row?.status)?row.status:'INSUFFICIENT_EVIDENCE';statuses.set(id,status);
 }
 return statuses;
}

export function serializeCouncilPayload(value:unknown):string{try{const result=JSON.stringify(value);if(typeof result!=='string')throw new Error();return result}catch{throw new Error('COUNCIL_INVALID_PAYLOAD: Candidate context must be JSON-serializable.')}}
