export interface AcceptanceEvidence{kind:string;status:'pass'|'fail'|'info'|'unknown';source:string;observedAt:string;summary:string;data?:Record<string,unknown>}
export interface ExecutionAcceptanceInput{executionTarget:'local'|'sandbox'|'hosted';result?:{schemaVersion?:string;completedAt?:string;executionId?:string};evidence:AcceptanceEvidence[];requiredKinds:string[];qualityGate?:{state:string;blockers?:unknown[]};maxAgeMs?:number}
export function executionAcceptance(input:ExecutionAcceptanceInput,now=Date.now()){
 const maxAge=input.maxAgeMs??6*60*60*1000,failures:string[]=[];
 if(input.result?.schemaVersion!=='fs-remote.execution-result.v1'&&input.executionTarget!=='sandbox')failures.push('execution result envelope missing or invalid');
 const executionId=typeof input.result?.executionId==='string'&&input.result.executionId.trim()?input.result.executionId.trim():'';
 if(!executionId)failures.push('execution identity is missing from the result envelope');
 if(input.qualityGate?.state==='blocked')failures.push('quality gate is blocked');
 const fresh=input.evidence.filter(e=>Number.isFinite(Date.parse(e.observedAt))&&now-Date.parse(e.observedAt)<=maxAge);
 const matching=executionId?fresh.filter(e=>e.data?.executionId===executionId):[];
 if(executionId&&!matching.some(e=>e.status==='pass'))failures.push('missing fresh passing matching execution evidence');
 if(matching.some(e=>e.status==='fail'))failures.push('matching execution evidence contains failure');
 for(const kind of input.requiredKinds){
  const xs=fresh.filter(e=>e.kind===kind);
  if(!xs.some(e=>e.status==='pass'))failures.push(`missing fresh passing ${kind} evidence`);
  if(xs.some(e=>e.status==='fail'))failures.push(`fresh ${kind} evidence contains failure`);
 }
 return{schemaVersion:'fs-remote.execution-acceptance.v1',accepted:failures.length===0,executionTarget:input.executionTarget,executionId:executionId||null,failures,evidenceCount:input.evidence.length,freshEvidenceCount:fresh.length,matchingEvidenceCount:matching.length,requiredKinds:input.requiredKinds};
}
