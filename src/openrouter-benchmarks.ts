import type {BenchmarkSnapshot} from './reviewer-source.js';
import type {ReviewerModel,BenchmarkRating} from './reviewer-broker.js';
const endpoint='https://openrouter.ai/api/v1/benchmarks?source=artificial-analysis';
// :free is a transport/cost variant. Never drop model revision suffixes to manufacture a match.
const identity=(id:string)=>id.replace(/:free$/,'');
const score=(x:unknown)=>typeof x==='number'&&Number.isFinite(x)&&x>=0&&x<=100?x/100:null;
export async function discoverOpenRouterBenchmarks(models:ReviewerModel[]):Promise<BenchmarkSnapshot[]>{
 const key=process.env.OPENROUTER_API_KEY,r=await fetch(endpoint,{headers:key?{Authorization:`Bearer ${key}`}:{},signal:AbortSignal.timeout(10000)});
 if(!r.ok)throw new Error(`OpenRouter benchmark catalog ${r.status}`);
 const body:any=await r.json(),observedAt=body.meta?.as_of;
 if(typeof observedAt!=='string'||!Number.isFinite(Date.parse(observedAt))||Date.parse(observedAt)>Date.now())return[];
 const source=typeof body.meta?.citation==='string'&&body.meta.citation.trim()?body.meta.citation:endpoint;
 const byId=new Map<string,any[]>();for(const row of Array.isArray(body.data)?body.data:[]){if(typeof row.model_permaslug!=='string')continue;const id=identity(row.model_permaslug);byId.set(id,[...(byId.get(id)??[]),row])}
 const out:BenchmarkSnapshot[]=[];
 for(const m of models.filter(m=>m.provider==='openrouter')){
  const listed=identity(m.id),canonical=identity(m.canonicalId??m.id);
  if(/-\d{8}$/.test(listed)&&canonical!==listed)continue;
  const rows=byId.get(canonical)??[];if(rows.length!==1)continue;const row=rows[0],ratings:BenchmarkRating[]=[];
  for(const [field,dimension,benchmark] of [['coding_index','coding','Artificial Analysis Coding Index'],['intelligence_index','reasoning','Artificial Analysis Intelligence Index'],['agentic_index','toolUse','Artificial Analysis Agentic Index']] as const){const v=score(row[field]);if(v!==null)ratings.push({benchmark,dimension,score:v,observedAt,source})}
  if(ratings.length)out.push({modelId:m.id,provider:'openrouter',ratings,observedAt,source});
 }return out;
}
