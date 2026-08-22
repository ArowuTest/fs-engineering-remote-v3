export interface ModelHealth{modelId:string;successes:number;failures:number;timeouts:number;lastFailureAt?:number;lastSuccessAt?:number}
const states=new Map<string,ModelHealth>();
const state=(id:string)=>states.get(id)??{modelId:id,successes:0,failures:0,timeouts:0};
export function recordModelSuccess(id:string){const s=state(id);s.successes++;s.lastSuccessAt=Date.now();states.set(id,s);return {...s}}
export function recordModelFailure(id:string,error:unknown){const s=state(id),message=error instanceof Error?error.message:String(error);s.failures++;if(/timeout|timed out|abort/i.test(message))s.timeouts++;s.lastFailureAt=Date.now();states.set(id,s);return {...s}}
export function modelReliability(id:string){const s=state(id),n=s.successes+s.failures;return n?Math.max(0,(s.successes-.5*s.timeouts)/n):1}
export function modelHealthSnapshot(){return [...states.values()].map(x=>({...x,reliability:modelReliability(x.modelId)}))}
export function resetModelHealth(){states.clear()}
