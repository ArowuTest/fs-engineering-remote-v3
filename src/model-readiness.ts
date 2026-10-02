import type {ModelGateway} from './model-gateway.js';
import {modelReliability,recordModelFailure,recordModelSuccess} from './model-health.js';
import {matchesModel,modelKey} from './benchmark-ranking.js';
export type ReadinessState='READY'|'DEGRADED'|'UNAVAILABLE'|'UNKNOWN';
export interface ModelReadiness{modelId:string;requestedModelId?:string;state:ReadinessState;checkedAt:string;latencyMs:number;reason:string;reliability:number}
let cacheGeneration=0;
export class ModelReadinessGate{
 private readonly cache=new Map<string,{expires:number;value:ModelReadiness}>();
 private generation=cacheGeneration;
 constructor(private gateway:ModelGateway,private ttlMs=2*60*1000,private latencyLimitMs=15000,private minimumReliability=.55){}
 async check(modelId:string,paidModelConsent=false,force=false):Promise<ModelReadiness>{
  if(this.generation!==cacheGeneration){this.cache.clear();this.generation=cacheGeneration}
  const start=Date.now();let identity=modelId,qualified=/^(openrouter|nvidia|openai)::.+$/.test(modelId);
  let value:ModelReadiness;
  try{
   // Resolve a bare id within this gateway's catalogue, not another gateway's cached authority.
   if(typeof this.gateway.availableModels==='function'){
    const matches=(await this.gateway.availableModels()).filter(m=>m.healthy&&matchesModel(m,modelId));
    if(matches.length!==1)throw new Error('MODEL_ROUTING_UNAVAILABLE: Exact model identity is absent or ambiguous; specify provider::model.');
    identity=modelKey(matches[0]);qualified=true;
   }
   if(!qualified)throw new Error('MODEL_ROUTING_UNAVAILABLE: An exact provider::model identity or catalogue resolver is required for readiness.');
   const key=identity+':'+paidModelConsent;
   for(const[k,item]of this.cache)if(item.expires<=Date.now())this.cache.delete(k);
   const hit=this.cache.get(key);if(!force&&hit)return{...hit.value,modelId:identity,requestedModelId:modelId};
   const out=await this.gateway.complete({criticality:'mechanical',task:'model-readiness-probe',configuredModelId:identity,paidModelConsent,allowFallback:false,system:'Health probe. Return only strict JSON.',prompt:'Return exactly {"ready":true}. No other text.'});
   const actual=out.routing?.model;
   const served=actual?`${actual.provider}::${actual.id}`:out.provider&&out.model?`${out.provider}::${String(out.model).replace(/^[^:]+::/,'')}`:'';
   if(!served||served!==identity)throw new Error('MODEL_READINESS_ROUTE_MISMATCH: Another model or no identified model answered the probe.');
   identity=served;qualified=true;
   let valid=false;try{valid=JSON.parse(out.text.trim())?.ready===true}catch{}
   if(!valid)throw new Error('Probe returned malformed/nonconforming structured output.');
   recordModelSuccess(identity);const reliability=modelReliability(identity),latencyMs=Date.now()-start;
   const reason=latencyMs>this.latencyLimitMs?`Probe latency ${latencyMs}ms exceeded ${this.latencyLimitMs}ms threshold.`:reliability<this.minimumReliability?`Rolling reliability ${reliability.toFixed(2)} is below ${this.minimumReliability}.`:'Exact model route passed structured live readiness probe.';
   value={modelId:identity,requestedModelId:modelId,state:latencyMs>this.latencyLimitMs||reliability<this.minimumReliability?'DEGRADED':'READY',checkedAt:new Date().toISOString(),latencyMs,reason,reliability};
   if(this.cache.size>=256)this.cache.delete(this.cache.keys().next().value!);
   // Cache only successful exact-identity probes; never share across gate instances or credentials.
   this.cache.set(key,{expires:Date.now()+this.ttlMs,value});
  }catch(error){
   if(qualified)recordModelFailure(identity,error);
   const reason=error instanceof Error?error.message:String(error);
   value={modelId:identity,requestedModelId:modelId,state:/404|not found|no endpoints|unavailable|disabled|MODEL_ROUTING_UNAVAILABLE/i.test(reason)?'UNAVAILABLE':'DEGRADED',checkedAt:new Date().toISOString(),latencyMs:Date.now()-start,reason,reliability:qualified?modelReliability(identity):0};
  }
  return value;
 }
}
export function resetReadinessCache(){cacheGeneration++}
