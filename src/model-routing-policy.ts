import type {ReviewerModel} from './reviewer-broker.js';
import {benchmarkRank,matchesModel,rankedModels} from './benchmark-ranking.js';
export type TaskCriticality='mechanical'|'supporting'|'outcome_critical';
export interface ModelRoutingRequest{criticality:TaskCriticality;configuredModelId?:string;paidModelConsent?:boolean;task:string}
export interface ModelRoutingDecision{selectionBasis?:'configured_override'|'benchmarked_free_default'|'benchmarked_free_fallback'|'benchmarked_paid_fallback'|'unavailable';model:ReviewerModel|null;requiresConsent:boolean;reason:string;usedFreeFallback:boolean;benchmark?:ReturnType<typeof benchmarkRank>}
export function routeModel(catalog:ReviewerModel[],request:ModelRoutingRequest):ModelRoutingDecision{
 const matches=request.configuredModelId?catalog.filter(m=>m.healthy&&matchesModel(m,request.configuredModelId!)):[];
 if(matches.length>1)throw new Error('MODEL_ID_AMBIGUOUS: Specify provider::model for this configured model identifier.');
 const configured=matches[0];
 // An explicit selection is an override, not invented benchmark qualification.
 if(configured&&(configured.free||request.paidModelConsent===true))return{selectionBasis:'configured_override',model:configured,requiresConsent:false,reason:'Using an explicitly configured, cost-authorized healthy model.',usedFreeFallback:false,benchmark:benchmarkRank(configured,request.task)};
 const ranked=rankedModels(catalog,request.task),free=ranked.find(x=>x.model.free);
 if(free)return{selectionBasis:request.configuredModelId?'benchmarked_free_fallback':'benchmarked_free_default',model:free.model,requiresConsent:false,reason:'Using strongest free model qualified by current task-relevant benchmark evidence.',usedFreeFallback:!!request.configuredModelId,benchmark:free.rank};
 const paid=request.paidModelConsent===true?ranked.find(x=>!x.model.free):undefined;
 if(paid)return{selectionBasis:'benchmarked_paid_fallback',model:paid.model,requiresConsent:false,reason:'No benchmark-qualified free model; selecting a qualified paid model under explicit consent.',usedFreeFallback:false,benchmark:paid.rank};
 const requiresConsent=request.paidModelConsent!==true&&ranked.some(x=>!x.model.free);
 return{selectionBasis:'unavailable',model:null,requiresConsent,reason:requiresConsent?'No qualified free model is available; eligible paid capacity requires explicit consent.':'No cost-authorized model has sufficient valid current task-relevant benchmark evidence.',usedFreeFallback:false};
}
