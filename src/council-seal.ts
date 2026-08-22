import crypto from 'node:crypto';
export interface CandidateSeal{candidateHash:string;contextHash:string;packetHash:string;sealedAt:string}
const hash=(v:unknown)=>crypto.createHash('sha256').update(typeof v==='string'?v:JSON.stringify(v)).digest('hex');
export function sealCandidate(candidate:string,context:unknown,sealedAt=new Date().toISOString()):CandidateSeal{const candidateHash=hash(candidate),contextHash=hash(context);return {candidateHash,contextHash,packetHash:hash({candidateHash,contextHash}),sealedAt}}
export function candidateChanged(seal:CandidateSeal,candidate:string){return seal.candidateHash!==hash(candidate)}
export function requiresFreshBlindCouncil(prior:CandidateSeal,candidate:string){return candidateChanged(prior,candidate)}
