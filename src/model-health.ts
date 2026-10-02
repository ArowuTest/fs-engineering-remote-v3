export interface ModelHealth{modelId:string;successes:number;failures:number;timeouts:number;lastFailureAt?:number;lastSuccessAt?:number}
// Advisory process-local history, not a durable health attestation. Unknown history never skips live readiness.
export const MAX_MODEL_HEALTH_ENTRIES=2048;
const states=new Map<string,ModelHealth>();
function remember(id:string,s:ModelHealth){states.delete(id);states.set(id,s);while(states.size>MAX_MODEL_HEALTH_ENTRIES)states.delete(states.keys().next().value!)}
const state=(id:string)=>states.get(id)??{modelId:id,successes:0,failures:0,timeouts:0};
export function recordModelSuccess(id:string){const s=state(id);s.successes++;s.lastSuccessAt=Date.now();remember(id,s);return {...s}}
export function recordModelFailure(id:string,error:unknown){const s=state(id),message=error instanceof Error?error.message:String(error);s.failures++;if(/timeout|timed out|abort/i.test(message))s.timeouts++;s.lastFailureAt=Date.now();remember(id,s);return {...s}}
export function modelReliability(id:string,now=Date.now()){const s=state(id),n=s.successes+s.failures;if(!n)return 1;const age=s.lastFailureAt?Math.max(0,now-s.lastFailureAt):Infinity,recovery=Math.min(1,age/(30*60*1000)),observed=Math.max(0,(s.successes-.5*s.timeouts)/n);return observed+(1-observed)*recovery}
export function modelHealthSnapshot(){return [...states.values()].map(x=>({...x,reliability:modelReliability(x.modelId)}))}
export function resetModelHealth(){states.clear()}
