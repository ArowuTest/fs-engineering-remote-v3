import test from 'node:test';
import assert from 'node:assert/strict';
import {ReviewCouncil} from '../src/council.js';
import {ReasoningFailure} from '../src/reasoning-errors.js';

const marker='PRIVATE_TERMINAL_FIXTURE_8d4bfe';
const context:any={product:{description:'fixture'},mission:{id:'m',goal:'fixture',root:'fs',cwd:'fixture'},step:{id:'s',title:'fixture',acceptance:['Terminal policy failures stop calls and expose only bounded public labels'],attempts:1},candidate:'fixture',capabilityContract:{},requirements:{overrides:[]},risk:{},truth:{},traceability:{},repositoryContext:{files:[]},evidence:[]};
const model=(id:string):any=>({id,provider:'openrouter',free:true,healthy:true,coding:.9,reasoning:.9,security:.9,context:1000,observedAt:new Date().toISOString(),source:'fixture',benchmarks:['coding','reasoning','security','toolUse','longContext'].map(d=>({benchmark:d,dimension:d,score:.9,observedAt:new Date().toISOString(),source:'fixture'}))});

for(const stage of ['primary','catalogue','replacement'] as const){
 test(`terminal ${stage} failures are sanitized without retries or adjudication`,async()=>{
  const calls:string[]=[];
  const fatal=()=>new ReasoningFailure(marker,'request',false);
  const provider:any={
   availableModels:async()=>{calls.push('catalogue');if(stage==='catalogue')throw fatal();return [model('primary'),model('replacement')]},
   complete:async(req:any)=>{calls.push(req.task+':'+String(req.configuredModelId));if(stage==='primary'||req.configuredModelId?.includes('replacement'))throw fatal();throw new Error('fixture unavailable')}
  };
  await assert.rejects(()=>new ReviewCouncil(provider).run({missionId:'m',goal:'fixture',candidate:'fixture',context,evidence:[],roles:['correctness'],models:['openrouter::primary'],maxAttempts:1,timeoutMs:100}), (error:any)=>{
   assert.ok(error instanceof ReasoningFailure);
   assert.equal(error.fallbackAllowed,false);
   assert.equal(error.scope,'request');
   assert.equal(error.kind,'reviewer_request_failed');
   assert.ok(!String(error).includes(marker));
   assert.ok(!JSON.stringify(error).includes(marker));
   return true;
  });
  assert.equal(calls.some(x=>x.includes('adjudication')),false);
  assert.equal(calls.length,stage==='primary'?1:stage==='catalogue'?2:3);
 });
}

for(const failure of [new Error(marker),new ReasoningFailure(marker,'request',false)]){
 test(`automatic catalogue preflight sanitizes ${failure.name} before any model call`,async()=>{
  let calls=0;
  const provider:any={availableModels:async()=>{throw failure},complete:async()=>{calls++;throw new Error('must not be called')}};
  await assert.rejects(()=>new ReviewCouncil(provider).run({missionId:'m',goal:'fixture',candidate:'fixture',context,evidence:[],roles:['correctness'],timeoutMs:50}), (error:any)=>{
   assert.ok(!String(error).includes(marker));assert.ok(!JSON.stringify(error).includes(marker));
   assert.equal(error.kind,'reviewer_request_failed');return true;
  });
  assert.equal(calls,0);
 });
}

test('a terminal denial cancels sibling calls and prevents their retries or undispatched roles',async()=>{
 const calls:string[]=[];let siblingAborted=false;
 const provider:any={availableModels:async()=>[model('first'),model('second'),model('third')],complete:async(req:any)=>{
  calls.push(req.task);
  if(req.task==='review:correctness'){await new Promise(r=>setTimeout(r,10));throw new ReasoningFailure('authorization_denied','request',false)}
  if(req.task==='review:security'){
   req.signal?.addEventListener('abort',()=>{siblingAborted=true},{once:true});
   // Even an adapter which notices abort but completes its own timer must not retry afterwards.
   await new Promise(r=>setTimeout(r,35));throw new Error('fixture transient');
  }
  return {provider:'openrouter',model:'third',text:JSON.stringify({verdict:'approve',summary:'fixture',findings:[]})};
 }};
 await assert.rejects(()=>new ReviewCouncil(provider).run({missionId:'m',goal:'fixture',candidate:'fixture',context,evidence:[],roles:['correctness','security','architecture'],models:['first','second','third'],maxAttempts:2,maxConcurrency:2,timeoutMs:100}),/authorization_denied/);
 await new Promise(r=>setTimeout(r,100));
 assert.deepEqual(calls,['review:correctness','review:security']);
 assert.equal(siblingAborted,true);
});
