import type {ReviewerModel,BenchmarkDimension,BenchmarkRating} from './reviewer-broker.js';
import {modelReliability} from './model-health.js';
export const modelKey=(m:Pick<ReviewerModel,'provider'|'id'>)=>`${m.provider}::${m.id}`;
export const matchesModel=(m:ReviewerModel,id:string)=>id===modelKey(m)||id===m.id;
export function taskWeights(task:string):Record<BenchmarkDimension,number>{
 const explicit=/^review:([a-z][a-z_-]*)(?:\s|$)/i.exec(task.trim())?.[1]?.toLowerCase();
 const roles=new Set(['security','hardening','penetration-test','penetration_test','correctness','testing','mobile','flutter','ux_accessibility','architecture','requirements','adjudication','reasoning']);
 if(explicit&&roles.has(explicit))task=explicit; // role labels outrank descriptive filenames; this is ranking, never authorization.

 if(/security|hardening|vulnerab|penetration[ _-]?test/i.test(task))return{coding:.2,reasoning:.2,security:.5,toolUse:.1,longContext:0};
 if(/test|correct|mobile|flutter|ux|coding/i.test(task))return{coding:.5,reasoning:.2,security:.05,toolUse:.15,longContext:.1};
 if(/architect|requirement|adjudicat|reason/i.test(task))return{coding:.15,reasoning:.5,security:.1,toolUse:.1,longContext:.15};
 return{coding:.4,reasoning:.3,security:.1,toolUse:.1,longContext:.1};
}
export function validBenchmarkRating(b:BenchmarkRating,now=Date.now(),maxAgeDays=90){
 const at=Date.parse(b.observedAt);
 return ['coding','reasoning','security','toolUse','longContext'].includes(b.dimension)&&Number.isFinite(at)&&at<=now&&at>=now-maxAgeDays*86400000&&Number.isFinite(b.score)&&b.score>=0&&b.score<=1&&typeof b.source==='string'&&!!b.source.trim()&&typeof b.benchmark==='string'&&!!b.benchmark.trim();
}
export function benchmarkRank(m:ReviewerModel,task:string,maxAgeDays=90,now=Date.now()){
 const latest=new Map<string,BenchmarkRating>();
 for(const b of m.benchmarks??[]){
  const at=Date.parse(b.observedAt);
  if(!validBenchmarkRating(b,now,maxAgeDays))continue;
  const key=`${b.dimension}:${b.benchmark}:${b.source}`,prior=latest.get(key);
  if(!prior||Date.parse(prior.observedAt)<at)latest.set(key,b);
 }
 let numerator=0,coverage=0;const evidence:string[]=[],ratings:BenchmarkRating[]=[];
 for(const [dimension,weight] of Object.entries(taskWeights(task)) as [BenchmarkDimension,number][]){
  if(!weight)continue;const xs=[...latest.values()].filter(x=>x.dimension===dimension);if(!xs.length)continue;
  // Conservative administrative ranking: do not cherry-pick conflicting normalized observations.
  const best=Math.min(...xs.map(x=>x.score));numerator+=best*weight;coverage+=weight;
  for(const b of xs.filter(x=>x.score===best)){evidence.push(`${b.benchmark}@${b.source}`);ratings.push({...b})}
 }
 const missingDimensions=Object.entries(taskWeights(task)).filter(([dimension,weight])=>weight>0&&!ratings.some(b=>b.dimension===dimension)).map(([dimension])=>dimension);
 return{qualificationPolicy:'weighted-current-evidence-v1:min-coverage=0.4',coverageComplete:missingDimensions.length===0,missingDimensions,score:coverage?numerator/coverage:-1,coverage,evidence:[...new Set(evidence)],ratings,basis:'benchmark' as const,qualified:coverage>=.4,asOf:new Date(now).toISOString()};
}
export function rankedModels(catalog:ReviewerModel[],task:string){
 return catalog.filter(m=>m.healthy).map(model=>({model,rank:benchmarkRank(model,task)})).filter(x=>x.rank.qualified)
  .sort((a,b)=>b.rank.score-a.rank.score||b.rank.coverage-a.rank.coverage||modelReliability(modelKey(b.model))-modelReliability(modelKey(a.model))||modelKey(a.model).localeCompare(modelKey(b.model)));
}
