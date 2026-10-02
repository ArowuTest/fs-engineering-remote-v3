import type {ReviewerModel} from './reviewer-broker.js';
import type {TaskCriticality} from './model-routing-policy.js';
import {routeModel} from './model-routing-policy.js';
import {benchmarkRank,rankedModels,modelKey,matchesModel} from './benchmark-ranking.js';
import {reasoningFailure} from './reasoning-errors.js';
export const freeFallbackRank=benchmarkRank;
export function freeFallbackChain(catalog:ReviewerModel[],task:string,exclude:string[]=[]){return rankedModels(catalog.filter(m=>m.free&&!exclude.some(id=>matchesModel(m,id))),task)}
export function isFailoverEligible(error:unknown){return reasoningFailure(error).fallbackAllowed}
export function fallbackChain(catalog:ReviewerModel[],input:{task:string;criticality:TaskCriticality;configuredModelId?:string;paidModelConsent?:boolean;excluded?:string[]}){
 const eligible=catalog.filter(m=>!(input.excluded??[]).some(id=>matchesModel(m,id))),decision=routeModel(eligible,input),out:ReviewerModel[]=[];
 if(decision.model)out.push(decision.model);
 for(const {model} of freeFallbackChain(eligible,input.task))if(!out.some(m=>modelKey(m)===modelKey(model)))out.push(model);
 // General consent permits qualified paid alternatives, but never places them ahead of free recovery.
 if(input.paidModelConsent===true)for(const {model} of rankedModels(eligible.filter(m=>!m.free),input.task))if(!out.some(m=>modelKey(m)===modelKey(model)))out.push(model);
 return out;
}
export function diverseCouncilAssignments(catalog:ReviewerModel[],roles:string[]){
 const used=new Set<string>();return roles.map(role=>{const ranked=freeFallbackChain(catalog,`review:${role}`),pick=ranked.find(x=>!used.has(modelKey(x.model)))??ranked[0];const reusedModel=!!pick&&used.has(modelKey(pick.model));if(pick)used.add(modelKey(pick.model));return{role,model:pick?.model??null,reusedModel}});
}
