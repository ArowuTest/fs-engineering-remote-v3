import type {BenchmarkDimension,BenchmarkRating,ReviewerProvider} from './reviewer-broker.js';
import type {BenchmarkSnapshot} from './reviewer-source.js';
const dims=new Set<BenchmarkDimension>(['coding','reasoning','security','toolUse','longContext']);
const providers=new Set<ReviewerProvider>(['openrouter','nvidia','openai']);
function validDate(x:unknown,now:number,skew:number){if(typeof x!=='string')return null;const n=Date.parse(x);return Number.isFinite(n)&&n<=now+skew?new Date(n).toISOString():null}
export function normalizeBenchmarkSnapshots(raw:unknown,now=Date.now(),maxFutureSkewMs=0):BenchmarkSnapshot[]{
 if(!Array.isArray(raw))return[];const out:BenchmarkSnapshot[]=[];
 for(const x of raw){
  if(!x||typeof x.modelId!=='string'||!x.modelId.trim()||!providers.has(x.provider)||!Array.isArray(x.ratings))continue;
  const datedRatings=x.ratings.map((r:any)=>validDate(r?.observedAt,now,maxFutureSkewMs)).filter((at:any):at is string=>at!==null).sort();
  const observedAt=x.observedAt===undefined?datedRatings[0]:validDate(x.observedAt,now,maxFutureSkewMs);if(!observedAt)continue;
  const ratings:BenchmarkRating[]=[];
  for(const r of x.ratings){
   if(!r||typeof r.benchmark!=='string'||!r.benchmark.trim()||!dims.has(r.dimension)||typeof r.score!=='number'||!Number.isFinite(r.score)||r.score<0||r.score>1||typeof r.source!=='string'||!r.source.trim())continue;
   const at=r.observedAt===undefined?observedAt:validDate(r.observedAt,now,maxFutureSkewMs);if(!at)continue;
   ratings.push({benchmark:r.benchmark.trim(),dimension:r.dimension,score:r.score,observedAt:at,source:r.source.trim(),...(Number.isInteger(r.sampleSize)&&r.sampleSize>0?{sampleSize:r.sampleSize}:{})});
  }
  if(ratings.length)out.push({modelId:x.modelId.trim(),provider:x.provider,ratings,observedAt,source:typeof x.source==='string'&&x.source.trim()?x.source.trim():ratings[0].source});
 }return out;
}
export function benchmarkFeedHealth(snapshots:BenchmarkSnapshot[],maxAgeDays=90,now=Date.now()){
 const ratings=snapshots.flatMap(s=>s.ratings.map(r=>({provider:s.provider,...r}))),fresh=ratings.filter(r=>Date.parse(r.observedAt)>=now-maxAgeDays*86400000&&Date.parse(r.observedAt)<=now);
 return{snapshots:snapshots.length,ratings:ratings.length,freshRatings:fresh.length,providers:[...new Set(fresh.map(r=>r.provider))],dimensions:[...new Set(fresh.map(r=>r.dimension))],healthy:fresh.length>0,oldestFreshObservedAt:fresh.length?new Date(Math.min(...fresh.map(r=>Date.parse(r.observedAt)))).toISOString():null};
}
