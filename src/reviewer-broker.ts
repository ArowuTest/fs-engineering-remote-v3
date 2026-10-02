import {benchmarkRank,modelKey,matchesModel,validBenchmarkRating} from './benchmark-ranking.js';
import {modelReliability} from './model-health.js';
export type ReviewerProvider='openrouter'|'nvidia'|'openai';
export type BenchmarkDimension='coding'|'reasoning'|'security'|'toolUse'|'longContext';
export interface BenchmarkRating{benchmark:string;dimension:BenchmarkDimension;score:number;observedAt:string;source:string;sampleSize?:number}
export interface ReviewerModel{id:string;provider:ReviewerProvider;free:boolean;coding:number;reasoning:number;security:number;context:number;healthy:boolean;observedAt:string;source:string;canonicalId?:string;benchmarks?:BenchmarkRating[];usageRank?:number}
export interface ReviewerFleet{models:ReviewerModel[];modelsMeaning?:'role_seat_allocations';uniqueModels?:ReviewerModel[];uniqueModelCount?:number;assignments?:{role:string;modelId:string;provider:ReviewerProvider;benchmarkScore:number;benchmarks:string[];reusedModel?:boolean}[];autoSelected:boolean;notification?:string;reason:string}
export function selectReviewerFleet(catalog:ReviewerModel[],roles:string[],configuredIds:string[]=[],paidModelConsent=false):ReviewerFleet{
 const available=catalog.filter(m=>m.healthy),healthy=available.filter(m=>m.free||paidModelConsent===true);
 const configured=configuredIds.map(id=>{const matches=available.filter(m=>matchesModel(m,id));if(matches.length>1)throw new Error('MODEL_ID_AMBIGUOUS: Specify provider::model for the configured reviewer.');const m=matches[0];return m&&(m.free||paidModelConsent===true)?m:undefined}).filter(Boolean) as ReviewerModel[];
 const capacity=(models:ReviewerModel[])=>{const uniqueModels=[...new Map(models.map(m=>[modelKey(m),m])).values()];return{modelsMeaning:'role_seat_allocations' as const,uniqueModels,uniqueModelCount:uniqueModels.length}};
 if(configured.length)return{models:configured,...capacity(configured),autoSelected:false,reason:'Using cost-authorized, unambiguous user-configured reviewer models.'};
 const chosen:ReviewerModel[]=[],assignments:NonNullable<ReviewerFleet['assignments']>=[];
 for(const role of roles){
  const ranked=healthy.map(m=>({m,b:benchmarkRank(m,`review:${role}`),reliability:modelReliability(modelKey(m))})).filter(x=>x.b.qualified).sort((a,b)=>{
   if(a.m.free!==b.m.free)return a.m.free?-1:1;
   const competence=b.b.score-a.b.score;if(Math.abs(competence)>.05)return competence;
   const operational=b.reliability-a.reliability;if(Math.abs(operational)>.05)return operational;
   return competence||modelKey(a.m).localeCompare(modelKey(b.m));
  });
  const free=ranked.filter(x=>x.m.free),pool=free.length?free:ranked;
  const pick=pool.find(x=>!chosen.some(c=>modelKey(c)===modelKey(x.m)))??pool[0];
  if(!pick)continue;
  const reusedModel=chosen.some(c=>modelKey(c)===modelKey(pick.m));chosen.push(pick.m);
  assignments.push({role,modelId:pick.m.id,provider:pick.m.provider,benchmarkScore:pick.b.score,benchmarks:pick.b.evidence,reusedModel});
 }
 return{models:chosen,...capacity(chosen),assignments,autoSelected:true,notification:'Reviewer roles were selected from current task-relevant benchmark evidence; reused models are disclosed, not counted as model diversity.',reason:chosen.length?'Selected qualified free capacity first; paid capacity requires explicit consent.':'No cost-authorized model has sufficient valid current benchmark coverage.'};
}
export function reviewerCatalogNeedsRefresh(catalog:ReviewerModel[],maxAgeMs=6*60*60*1000){
 const now=Date.now();return !catalog.some(m=>{const at=Date.parse(m.observedAt);return m.healthy&&Number.isFinite(at)&&at<=now&&now-at<=maxAgeMs&&(m.benchmarks??[]).some(b=>validBenchmarkRating(b,now))});
}
