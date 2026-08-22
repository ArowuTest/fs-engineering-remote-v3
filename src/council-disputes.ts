import type {Finding} from './finding-verification.js';
export type RechallengeVerdict='RETRACT'|'MAINTAIN'|'REFINE'|'INSUFFICIENT_EVIDENCE';
export interface RechallengeResult{findingId:string;role:string;verdict:RechallengeVerdict;reason:string;refinedFinding?:Partial<Finding>;raw:string}
export interface DisputeResult{findingId:string;status:'CONFIRMED'|'PARTIALLY_VALID'|'REJECTED'|'INSUFFICIENT_EVIDENCE';reason:string;raw:string}
export function needsRechallenge(finding:Finding&{adjudicationStatus?:string}){return finding.adjudicationStatus==='REJECTED'&&['medium','high','critical'].includes(finding.severity)}
export function needsIndependentDispute(r:RechallengeResult){return r.verdict==='MAINTAIN'}
export function parseRechallenge(finding:Finding,raw:string):RechallengeResult{let x:any;try{x=JSON.parse(raw.match(/\{[\s\S]*\}/)?.[0]??raw)}catch{};const verdict:RechallengeVerdict=['RETRACT','MAINTAIN','REFINE','INSUFFICIENT_EVIDENCE'].includes(x?.verdict)?x.verdict:'INSUFFICIENT_EVIDENCE';return {findingId:finding.id,role:finding.role,verdict,reason:String(x?.reason??'Unstructured rechallenge response.'),refinedFinding:x?.refinedFinding,raw}}
export function parseDispute(findingId:string,raw:string):DisputeResult{let x:any;try{x=JSON.parse(raw.match(/\{[\s\S]*\}/)?.[0]??raw)}catch{};const status=['CONFIRMED','PARTIALLY_VALID','REJECTED','INSUFFICIENT_EVIDENCE'].includes(x?.status)?x.status:'INSUFFICIENT_EVIDENCE';return {findingId,status,reason:String(x?.reason??'Unstructured dispute adjudication.'),raw}}
