import test from 'node:test';
import assert from 'node:assert/strict';
import {responseFailure} from '../src/reasoning-errors.js';
import {OpenRouterProvider, resetReasoningHealth} from '../src/reasoning.js';
import {ModelGateway} from '../src/model-gateway.js';

const model='fixture/busy:free';
const metadata={provider_name:'FixtureProvider',is_byok:false,provider_error_code:'429',limit_source:'upstream_provider_shared_pool',raw:`${model} is temporarily rate-limited upstream. Private diagnostic must not leave the classifier.`,remedy_hint:'Private diagnostic'};
const fail=(m:Record<string,unknown>,retryAfter:string|null=null)=>responseFailure('openrouter',model,429,{code:429,message:'Provider returned error',metadata:m},retryAfter);
const response=(m:Record<string,unknown>,headers:Record<string,string>={})=>new Response(JSON.stringify({error:{code:429,message:'Provider returned error',metadata:m}}),{status:429,headers});
async function mockFetch(fn:typeof fetch,run:()=>Promise<void>){const old=globalThis.fetch;resetReasoningHealth();globalThis.fetch=fn;try{await run()}finally{globalThis.fetch=old;resetReasoningHealth()}}

test('N01 nested upstream shared-pool limit is model-scoped without exposing raw text',()=>{
 const e=fail(metadata);assert.equal(e.scope,'model');assert.equal(e.fallbackAllowed,true);assert.doesNotMatch(JSON.stringify(e),/Private diagnostic|remedy_hint/);
});
test('N02 explicit account/platform/unknown scope overrides misleading upstream text',()=>{
 for(const overrides of [{limit_source:'openrouter_free_daily'},{limit_source:'openrouter_free_rpm'},{limit_source:'unrecognized_future_limit'},{scope:'provider'},{scope:'account'},{limit_scope:'account'},{is_byok:true}])assert.equal(fail({...metadata,...overrides}).scope,'provider',JSON.stringify(overrides));
});
test('N03 legacy raw format is accepted only when it identifies the exact requested model',()=>{
 const {limit_source,...legacy}=metadata;assert.equal(fail(legacy).scope,'model');
 for(const raw of ['another/model:free is temporarily rate-limited upstream.','Account rate limit exceeded','unavailable',''])assert.equal(fail({...legacy,raw}).scope,'provider');
});
test('N04 cooldown honors the longest valid server retry hint, including metadata',()=>{
 assert.equal(fail({...metadata,retry_after_seconds:120,headers:{'Retry-After':'90'}},'60').retryAfterMs,120000);
 assert.throws(()=>fail({...metadata,retry_after_seconds:-1,headers:{'Retry-After':'bogus'}},'60'),/invalid_retry_duration/);
});
test('N05 structured authorization/moderation takes priority over availability text',()=>{
 for(const type of ['permission_denied','authentication_error','content_policy_violation']){
  const e=responseFailure('openrouter',model,403,{message:'This model is not available to this client',metadata:{...metadata,error_type:type}},null);
  assert.equal(e.fallbackAllowed,false,type);assert.equal(e.scope,'request',type);
 }
});
test('N06 actual transport honors nested model cooldown while allowing another model',async()=>{
 const calls:string[]=[];
 await mockFetch(async(_url,options)=>{const id=JSON.parse(String(options?.body)).model;calls.push(id);return id===model?response({...metadata,retry_after_seconds:120}):new Response(JSON.stringify({choices:[{message:{content:'ok'}}]}),{status:200})},async()=>{
  const p=new OpenRouterProvider('fixture');await assert.rejects(()=>p.complete({model,system:'fixture',prompt:'fixture'}));
  assert.equal((await p.complete({model:'fixture/other:free',system:'fixture',prompt:'fixture'})).text,'ok');
  await assert.rejects(()=>p.complete({model,system:'fixture',prompt:'fixture'}));assert.deepEqual(calls,[model,'fixture/other:free']);
 });
});
test('N07 platform rate-limit response headers override model metadata',async()=>{
 let calls=0;await mockFetch(async()=>{calls++;return response(metadata,{'x-ratelimit-remaining':'0','x-ratelimit-reset':String(Math.ceil(Date.now()/1000)+120),'retry-after':'120'})},async()=>{
  const p=new OpenRouterProvider('fixture');await assert.rejects(()=>p.complete({model,system:'fixture',prompt:'fixture'}));await assert.rejects(()=>p.complete({model:'fixture/other:free',system:'fixture',prompt:'fixture'}));assert.equal(calls,1);
 });
});
test('N08 full gateway tries the next benchmark-qualified free model after nested upstream exhaustion',async()=>{
 const at=new Date().toISOString(),make=(id:string,score:number)=>({id,provider:'openrouter' as const,free:true,healthy:true,coding:0,reasoning:0,security:0,context:100000,source:'fixture',observedAt:at,benchmarks:['coding','reasoning','security','toolUse','longContext'].map(d=>({benchmark:d,dimension:d as any,score,source:'fixture',observedAt:at}))});
 const models=[make(model,.9),make('fixture/other:free',.8)],calls:string[]=[];
 await mockFetch(async(_url,options)=>{const id=JSON.parse(String(options?.body)).model;calls.push(id);return id===model?response(metadata):new Response(JSON.stringify({model:id,choices:[{message:{content:'{"ready":true}'}}]}),{status:200})},async()=>{
  const gateway=new ModelGateway(new OpenRouterProvider('fixture'),{list:async()=>models,upsert:async()=>{}} as any);
  // The production MultiProvider adapter removes the provider prefix before HTTP.
  const adapter={complete:(r:any)=>new OpenRouterProvider('fixture').complete({...r,model:r.model.replace(/^openrouter::/,'')})};
  const g=new ModelGateway(adapter,{list:async()=>models,upsert:async()=>{}} as any);
  const out=await g.complete({criticality:'outcome_critical',task:'review:correctness',paidModelConsent:false,system:'fixture',prompt:'fixture'});
  assert.deepEqual(calls,[model,'fixture/other:free']);assert.equal(out.routing.model.id,'fixture/other:free');assert.ok(out.routing.attempts.every((a:any)=>a.free===true));assert.equal(out.routing.attempts[0].scope,'model');
 });
});
