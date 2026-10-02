import test from 'node:test';import assert from 'node:assert/strict';import path from 'node:path';import {fileURLToPath} from 'node:url';import {PersistentProcessShadowDecisionProvider} from '../src/decision-shadow-persistent.js';import {compileDecisionState} from '../src/decision-state.js';
const req:any={schemaVersion:'fs.decision.request.v1',state:compileDecisionState({operation:'x'}),questions:[{id:'retry',type:'noul',proposition:'Retry?'}]};
test('persistent provider reuses one process across decisions and remains non-authoritative',async()=>{const f=path.join(path.dirname(fileURLToPath(import.meta.url)),'fixtures','persistent-shadow-provider.mjs'),p=new PersistentProcessShadowDecisionProvider({command:process.execPath,args:[f],providerName:'warm'});try{const a=await p.decide(req),b=await p.decide(req);assert.equal(a.provider,'warm');assert.equal(b.answers[0].probabilityTrue,.8);assert.equal(a.evidence.authoritative,false)}finally{p.stop()}});


test('persistent shadow provider does not inherit host secrets implicitly',async()=>{
 const prior=process.env.NVIDIA_API_KEY;process.env.NVIDIA_API_KEY='SECRET_PERSISTENT_ENV_MARKER';
 const script=`const readline=require('node:readline');const rl=readline.createInterface({input:process.stdin});rl.on('line',()=>{console.log(JSON.stringify({schemaVersion:'fs.decision.result.v1',answers:[{id:'retry',type:'noul',distribution:{false:1,true:0},probabilityTrue:0,confidence:.9,abstained:false,reason:process.env.NVIDIA_API_KEY||''}],evidence:{stateSchemaVersion:'x',providerVersion:'fixture',policyVersion:'none',authoritative:true,notes:[]},createdAt:new Date().toISOString()}));});`;
 const p=new PersistentProcessShadowDecisionProvider({command:process.execPath,args:['-e',script],providerName:'persistent-fixture'});
 try{const r=await p.decide(req);assert.equal(r.answers[0].reason,'');assert.doesNotMatch(JSON.stringify(r),/SECRET_PERSISTENT_ENV_MARKER/)}finally{p.stop();if(prior===undefined)delete process.env.NVIDIA_API_KEY;else process.env.NVIDIA_API_KEY=prior}
});

test('persistent shadow provider keeps explicitly supplied environment values',async()=>{
 const script=`const readline=require('node:readline');const rl=readline.createInterface({input:process.stdin});rl.on('line',()=>{console.log(JSON.stringify({schemaVersion:'fs.decision.result.v1',answers:[{id:'retry',type:'noul',distribution:{false:.2,true:.8},probabilityTrue:.8,confidence:.8,abstained:false,reason:process.env.EXPLICIT_PERSISTENT_VALUE||''}],evidence:{stateSchemaVersion:'x',providerVersion:'fixture',policyVersion:'none',authoritative:false,notes:[]},createdAt:new Date().toISOString()}));});`;
 const p=new PersistentProcessShadowDecisionProvider({command:process.execPath,args:['-e',script],providerName:'persistent-fixture',env:{EXPLICIT_PERSISTENT_VALUE:'explicit-ok'}});
 try{const r=await p.decide(req);assert.equal(r.answers[0].reason,'explicit-ok')}finally{p.stop()}
});
