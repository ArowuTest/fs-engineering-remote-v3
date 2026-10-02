import {db,databaseEnabled} from './db.js';
import {modelKey} from './benchmark-ranking.js';
import type {ReviewerModel} from './reviewer-broker.js';
export class ReviewerCatalogStore{
 async list():Promise<ReviewerModel[]>{
  if(!databaseEnabled())return[];
  const result=await db().query('SELECT * FROM reviewer_catalog WHERE healthy=true ORDER BY observed_at DESC');
  const models=new Map<string,{model:ReviewerModel;qualifiedKey:boolean}>();
  for(const x of result.rows){
   if(!['openrouter','nvidia','openai'].includes(x.provider)||typeof x.model_id!=='string')continue;
   const prefix=/^(openrouter|nvidia|openai)::/.exec(x.model_id);
   if(prefix&&prefix[1]!==x.provider)continue;
   const id=prefix?x.model_id.slice(prefix[0].length):x.model_id;
   const model:ReviewerModel={id,provider:x.provider,free:x.free,coding:Number(x.metadata?.coding??0),reasoning:Number(x.metadata?.reasoning??0),security:Number(x.metadata?.security??0),context:Number(x.metadata?.context??0),healthy:x.healthy,observedAt:new Date(x.observed_at).toISOString(),source:x.source,canonicalId:x.metadata?.canonicalId,benchmarks:x.benchmarks??[],usageRank:x.metadata?.usageRank};
   const key=modelKey(model),prior=models.get(key),qualifiedKey=!!prefix;
   // Read legacy bare IDs, but a newly qualified cache row wins a duplicate. No destructive migration.
   if(!prior||qualifiedKey&&!prior.qualifiedKey)models.set(key,{model,qualifiedKey});
  }
  return [...models.values()].map(x=>x.model);
 }
 async upsert(models:ReviewerModel[]){
  if(!databaseEnabled())return;
  for(const m of models){
   if(!m.id||/^(openrouter|nvidia|openai)::/.test(m.id))throw new Error('Catalogue model id must be the raw provider model identifier.');
   await db().query(`INSERT INTO reviewer_catalog(model_id,provider,free,healthy,observed_at,source,metadata,benchmarks) VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT(model_id) DO UPDATE SET free=EXCLUDED.free,healthy=EXCLUDED.healthy,observed_at=EXCLUDED.observed_at,source=EXCLUDED.source,metadata=EXCLUDED.metadata,benchmarks=EXCLUDED.benchmarks WHERE reviewer_catalog.provider=EXCLUDED.provider`,[modelKey(m),m.provider,m.free,m.healthy,m.observedAt,m.source,{canonicalId:m.canonicalId,coding:m.coding,reasoning:m.reasoning,security:m.security,context:m.context,usageRank:m.usageRank},JSON.stringify(m.benchmarks??[])]);
  }
 }
}
