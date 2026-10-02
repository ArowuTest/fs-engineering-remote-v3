import type {ReasoningProvider,ReasoningRequest,ReasoningResponse} from './reasoning.js';
import {reasoningProvider} from './reasoning.js';
import {recordModelFailure,recordModelSuccess} from './model-health.js';
import {ReviewerCatalogStore} from './reviewer-catalog.js';
import {refreshReviewerCatalog} from './reviewer-source.js';
import {reviewerCatalogNeedsRefresh,type ReviewerModel} from './reviewer-broker.js';
import {routeModel,type TaskCriticality} from './model-routing-policy.js';
import {fallbackChain} from './model-fallback.js';
import {benchmarkRank,modelKey,matchesModel} from './benchmark-ranking.js';
import {ReasoningFailure,reasoningFailure} from './reasoning-errors.js';
export interface GovernedReasoningRequest extends ReasoningRequest{criticality:TaskCriticality;task:string;configuredModelId?:string;paidModelConsent?:boolean;allowFallback?:boolean}
export class ModelGateway{
 private memoryCatalog:ReviewerModel[]=[];
 constructor(private readonly provider:ReasoningProvider=reasoningProvider(),private readonly catalog=new ReviewerCatalogStore()){}
 async availableModels():Promise<ReviewerModel[]>{
  let models=await this.catalog.list();if(!models.length&&this.memoryCatalog.length)models=this.memoryCatalog;
  if(reviewerCatalogNeedsRefresh(models)){try{const fresh=await refreshReviewerCatalog();this.memoryCatalog=fresh.models;await this.catalog.upsert(fresh.models);models=await this.catalog.list();if(!models.length)models=this.memoryCatalog}catch(error){if(!models.length)throw new Error(`Model routing catalog unavailable: ${error instanceof Error?error.message:String(error)}`)}}return models;
 }
 async complete(req:GovernedReasoningRequest):Promise<ReasoningResponse&{routing:any}>{
  req.signal?.throwIfAborted();const models=await this.availableModels(),configured=req.configuredModelId??req.model;
  const decision=routeModel(models,{criticality:req.criticality,configuredModelId:configured,paidModelConsent:req.paidModelConsent,task:req.task});
  if(decision.requiresConsent)throw new Error(`PAID_MODEL_CONSENT_REQUIRED: ${decision.reason}`);
  if(!decision.model)throw new Error(`MODEL_ROUTING_UNAVAILABLE: ${decision.reason}`);
  if(req.allowFallback===false&&configured&&!matchesModel(decision.model,configured))throw new Error('MODEL_ROUTING_UNAVAILABLE: Exact requested model is not authorized/available.');
  const chain=req.allowFallback===false?[decision.model]:fallbackChain(models,{task:req.task,criticality:req.criticality,configuredModelId:configured,paidModelConsent:req.paidModelConsent});
  const attempts:any[]=[],blockedProviders=new Set<string>(),blockedPaidProviders=new Set<string>();
  const deadline=AbortSignal.timeout(Math.max(1,Math.min(900000,req.timeoutMs??120000))),signal=req.signal?AbortSignal.any([req.signal,deadline]):deadline;
  for(const candidate of chain){
   signal.throwIfAborted();const key=modelKey(candidate),basis=benchmarkRank(candidate,req.task);
   if(blockedProviders.has(candidate.provider)||!candidate.free&&blockedPaidProviders.has(candidate.provider)){attempts.push({modelId:candidate.id,provider:candidate.provider,status:'bypassed',reason:'provider_or_credit_scope_unavailable'});continue}
   try{
    const out=await this.provider.complete({...req,signal,timeoutMs:Math.min(req.timeoutMs??90000,90000),model:key,costClass:candidate.free?'free':'paid'});
    signal.throwIfAborted();if(!out.text?.trim())throw new ReasoningFailure('empty_output','model',true);
    recordModelSuccess(key);attempts.push({modelId:candidate.id,provider:candidate.provider,free:candidate.free,status:'success',basis});
    return{...out,routing:{...decision,initialDecision:decision,model:{id:candidate.id,provider:candidate.provider,free:candidate.free},usedFreeFallback:candidate.free&&((!!configured&&!matchesModel(candidate,configured))||modelKey(candidate)!==modelKey(decision.model!)),fallback:{basis:basis.basis,benchmarkCoverage:basis.coverage,benchmarkEvidence:basis.evidence},attempts,task:req.task,criticality:req.criticality}};
   }catch(error){
    if(signal.aborted)throw signal.reason;
    const failure=reasoningFailure(error);recordModelFailure(key,failure);
    attempts.push({modelId:candidate.id,provider:candidate.provider,free:candidate.free,status:'failed',error:failure.message,kind:failure.kind,scope:failure.scope,retryAfterMs:failure.retryAfterMs,basis});
    if(!failure.fallbackAllowed){Object.assign(failure,{attempts});throw failure}
    if(failure.scope==='provider')blockedProviders.add(candidate.provider);
    if(failure.scope==='paid_provider')blockedPaidProviders.add(candidate.provider);
   }
  }
  const exhausted=new Error(`MODEL_FALLBACK_EXHAUSTED: ${attempts.map(x=>`${x.provider}::${x.modelId}=${x.status}`).join(' -> ')}`);Object.assign(exhausted,{attempts});throw exhausted;
 }
}
export function modelGateway(){return new ModelGateway()}
