import test from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import {selectReviewerFleet,reviewerCatalogNeedsRefresh,type ReviewerModel} from '../src/reviewer-broker.js';
import {routeModel} from '../src/model-routing-policy.js';
import {fallbackChain,diverseCouncilAssignments} from '../src/model-fallback.js';
import {benchmarkRank} from '../src/benchmark-ranking.js';
import {ReviewerCatalogStore} from '../src/reviewer-catalog.js';
import {discoverNvidiaModels} from '../src/reviewer-source.js';
import {discoverOpenRouterBenchmarks} from '../src/openrouter-benchmarks.js';
import {reasoningFailure,responseFailure} from '../src/reasoning-errors.js';
import {OpenRouterProvider,resetReasoningHealth} from '../src/reasoning.js';
const now=new Date().toISOString();
const model=(id:string,provider:'openrouter'|'nvidia'='openrouter',free=true):ReviewerModel=>({id,provider,free,healthy:true,context:10000,coding:0,reasoning:0,security:0,observedAt:now,source:'fixture',benchmarks:['coding','reasoning','security','toolUse','longContext'].map(d=>({dimension:d as any,benchmark:d,score:.8,observedAt:now,source:'fixture'}))});

test('S20 fleet auto-selection and configured paid preferences require cost consent',()=>{
 const paid=model('paid','openrouter',false);
 assert.equal(selectReviewerFleet([paid],['correctness']).models.length,0);
 assert.equal(selectReviewerFleet([paid],['correctness'],['paid']).models.length,0);
 assert.equal((selectReviewerFleet as any)([paid],['correctness'],['paid'],true).models[0]?.id,'paid');
});
test('S21 routing rejects ambiguous bare model IDs instead of picking the first provider',()=>{
 const xs=[model('same'),model('same','nvidia')];
 assert.throws(()=>routeModel(xs,{task:'coding',criticality:'supporting',configuredModelId:'same'}),/ambiguous|provider/i);
 assert.throws(()=>fallbackChain(xs,{task:'coding',criticality:'supporting',configuredModelId:'same'}),/ambiguous|provider/i);
 assert.equal(routeModel(xs,{task:'coding',criticality:'supporting',configuredModelId:'nvidia::same'}).model?.provider,'nvidia');
});
test('S22 persisted catalogue keys and reader preserve provider-qualified identity and legacy rows',async()=>{
 const oldUrl=process.env.DATABASE_URL,old=pg.Pool.prototype.query;const records:any[]=[];process.env.DATABASE_URL='postgres://fixture:fixture@127.0.0.1:1/never_connect';
 (pg.Pool.prototype.query as any)=async(sql:string,args:any[]=[])=>{if(sql.startsWith('INSERT')){records.push(args);return{rowCount:1,rows:[]}}return{rows:[{model_id:'same',provider:'openrouter',healthy:true,free:true,observed_at:now,source:'legacy',metadata:{},benchmarks:[]},...records.map(a=>({model_id:a[0],provider:a[1],free:a[2],healthy:a[3],observed_at:a[4],source:a[5],metadata:a[6],benchmarks:JSON.parse(a[7])}))]}};
 try{const store=new ReviewerCatalogStore();await store.upsert([model('same'),model('same','nvidia')]);assert.notEqual(records[0][0],records[1][0]);const rows=await store.list();assert.deepEqual(rows.map(m=>`${m.provider}::${m.id}`).sort(),['nvidia::same','openrouter::same']);assert.equal(rows.find(m=>m.provider==='openrouter')?.source,'fixture')}finally{pg.Pool.prototype.query=old;if(oldUrl===undefined)delete process.env.DATABASE_URL;else process.env.DATABASE_URL=oldUrl}
});
test('S23 developer free override cannot contradict explicit nonzero NVIDIA pricing',async()=>{
 const old=globalThis.fetch,key=process.env.NVIDIA_API_KEY,flag=process.env.FS_REMOTE_NVIDIA_DEV_FREE;process.env.NVIDIA_API_KEY='fixture';process.env.FS_REMOTE_NVIDIA_DEV_FREE='true';
 globalThis.fetch=async()=>new Response(JSON.stringify({data:[{id:'priced',pricing:{prompt:'1',completion:'2'}},{id:'unknown'},{id:'zero',pricing:{prompt:'0',completion:'0'}}]}));
 try{const rows=await discoverNvidiaModels();assert.equal(rows.find(m=>m.id==='priced')?.free,false);assert.equal(rows.find(m=>m.id==='unknown')?.free,true);assert.equal(rows.find(m=>m.id==='zero')?.free,true)}finally{globalThis.fetch=old;if(key===undefined)delete process.env.NVIDIA_API_KEY;else process.env.NVIDIA_API_KEY=key;if(flag===undefined)delete process.env.FS_REMOTE_NVIDIA_DEV_FREE;else process.env.FS_REMOTE_NVIDIA_DEV_FREE=flag}
});
test('S24 dated model cannot acquire an undated or different revision benchmark via canonical alias',async()=>{
 const old=globalThis.fetch;globalThis.fetch=async()=>new Response(JSON.stringify({meta:{as_of:now},data:[{model_permaslug:'fixture/model',coding_index:80}]}));
 try{const rows=await discoverOpenRouterBenchmarks([{...model('fixture/model-20260929:free'),canonicalId:'fixture/model'}]);assert.equal(rows.length,0)}finally{globalThis.fetch=old}
});
test('S25 catalogue refresh rejects future observations and invalid benchmark evidence',()=>{
 for(const b of [{score:99},{source:''},{benchmark:''},{observedAt:'not-a-date'}]){const m=model('bad');m.benchmarks=m.benchmarks!.map(x=>({...x,...b}));assert.equal(reviewerCatalogNeedsRefresh([m]),true)}
 assert.equal(reviewerCatalogNeedsRefresh([{...model('future'),observedAt:new Date(Date.now()+86400000).toISOString()}]),true);
 assert.equal(reviewerCatalogNeedsRefresh([model('valid')]),false);
});
test('S26 repeated model across independent role prompts is disclosed, not presented as model diversity',()=>{
 const rows=diverseCouncilAssignments([model('one')],['correctness','security']) as any[];
 assert.equal(rows[0].reusedModel,false);assert.equal(rows[1].reusedModel,true);
});
test('S27 no qualified capacity does not ask for already-granted paid consent',()=>{
 const paid={...model('paid','openrouter',false),benchmarks:[]};const r=routeModel([paid],{task:'coding',criticality:'supporting',paidModelConsent:true});assert.equal(r.model,null);assert.equal(r.requiresConsent,false);
 const empty=routeModel([],{task:'coding',criticality:'supporting'});assert.equal(empty.requiresConsent,false);assert.doesNotMatch(empty.reason,/requires explicit consent/i);
});
test('S28 conflicting fresh benchmark evidence cannot be cherry-picked by highest score',()=>{
 const m=model('contradiction');m.benchmarks=m.benchmarks!.flatMap(b=>[{...b,score:.95,source:'optimistic'},{...b,score:.5,source:'conservative'}]);const rank=benchmarkRank(m,'coding');assert.equal(rank.score,.5);assert.ok(rank.evidence.some(s=>s.includes('conservative')));
});
test('T20 quota classification does not grant fallback authority to arbitrary error-message prefixes',()=>{
 assert.equal(reasoningFailure(new Error('openrouter 429: model temporarily unavailable')).fallbackAllowed,false);
 assert.equal(responseFailure('openrouter','m',429,{message:'Model rate limit upstream',metadata:{provider_name:'fixture'}},null).scope,'provider');
});
test('T21 embedded HTTP200 rate error respects platform quota headers',async()=>{
 const old=globalThis.fetch;resetReasoningHealth();let calls=0;
 globalThis.fetch=async()=>{calls++;return new Response(JSON.stringify({error:{code:429,message:'Provider returned error',metadata:{scope:'model',provider_name:'fixture'}}}),{status:200,headers:{'x-ratelimit-limit':'1','retry-after':'60'}})};
 try{const p=new OpenRouterProvider('fixture');await assert.rejects(()=>p.complete({model:'one:free',system:'fixture',prompt:'fixture'}),(e:any)=>e.scope==='provider');await assert.rejects(()=>p.complete({model:'two:free',system:'fixture',prompt:'fixture'}));assert.equal(calls,1)}finally{globalThis.fetch=old;resetReasoningHealth()}
});

test('S29 configured fleet ambiguity is rejected before cost filtering',()=>{
 const xs=[model('same'),model('same','nvidia',false)];
 assert.throws(()=>selectReviewerFleet(xs,['correctness'],['same']),/ambiguous|provider/i);
});
test('S30 partial benchmark qualification discloses its weighted policy and missing dimensions',()=>{
 const m=model('partial');m.benchmarks=m.benchmarks!.filter(x=>['coding','reasoning'].includes(x.dimension));
 const b=benchmarkRank(m,'review:security') as any;
 assert.equal(b.qualified,true);assert.equal(b.coverage,.4);assert.equal(b.coverageComplete,false);assert.ok(b.missingDimensions.includes('security'));assert.match(b.qualificationPolicy,/weighted.*0.4/);
});
test('S31 explicit override and free default have distinct decision provenance',()=>{
 const configured={...model('override'),benchmarks:[]};
 const a=routeModel([configured],{criticality:'supporting',task:'coding',configuredModelId:'override'}) as any;
 assert.equal(a.selectionBasis,'configured_override');assert.equal(a.benchmark.qualified,false);
 const b=routeModel([model('free')],{criticality:'supporting',task:'coding'}) as any;
 assert.equal(b.selectionBasis,'benchmarked_free_default');assert.equal(b.usedFreeFallback,false);
});
test('S32 fleet capacity is explicitly separated from reused role seats',()=>{
 const fleet=selectReviewerFleet([model('one')],['correctness','security']) as any;
 assert.equal(fleet.uniqueModels.length,1);assert.equal(fleet.uniqueModelCount,1);assert.equal(fleet.assignments.length,2);assert.equal(fleet.assignments[1].reusedModel,true);
});
test('S33 readiness returns resolved identity independently of the requested alias',async()=>{
 const {ModelReadinessGate}=await import('../src/model-readiness.js');const g:any={availableModels:async()=>[model('one')],complete:async()=>({provider:'openrouter',model:'one',text:'{"ready":true}',routing:{model:{provider:'openrouter',id:'one'}}})};
 const gate=new ModelReadinessGate(g,60000,10000,0);for(let i=0;i<2;i++){const result=await gate.check('one') as any;assert.equal(result.modelId,'openrouter::one');assert.equal(result.requestedModelId,'one');assert.equal(result.state,'READY')}
});
test('S34 gateway reports the free default honestly rather than a nonexistent fallback',async()=>{
 const {ModelGateway}=await import('../src/model-gateway.js');const g=new ModelGateway({complete:async()=>({provider:'openrouter',model:'one',text:'ok'})},{list:async()=>[model('one')],upsert:async()=>{}} as any);
 const r=await g.complete({criticality:'supporting',task:'coding',system:'fixture',prompt:'fixture'});assert.equal(r.routing.usedFreeFallback,false);
});
