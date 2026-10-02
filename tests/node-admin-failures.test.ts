import test from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import {NodeRegistry} from '../src/nodes.js';
import {registerNodeRoutes} from '../src/node-http.js';
import {validateConfig} from '../src/config.js';
import {db} from '../src/db.js';
const auth={authorization:'Bearer '+'a'.repeat(48)};
const registration={nodeId:'fixture-node',name:'Fixture',platform:'win32',capabilities:['command'],projects:['fixture']};
const dispatch={missionId:'fixture-mission',stepId:'step-1',nodeId:'fixture-node',project:'fixture',capability:'command',operation:'run',payload:{command:'fixture'}};
async function appFixture(run:(app:ReturnType<typeof Fastify>)=>Promise<void>){const app=Fastify({logger:false,bodyLimit:1_000_000});registerNodeRoutes(app,validateConfig({endpointSecret:'e'.repeat(48),actionsSecret:'a'.repeat(48),roots:[{name:'fixture',path:process.cwd()}]}));try{await run(app)}finally{await app.close()}}
for(const route of ['register','enqueue'])test(`NODE-ADMIN-01 ${route} malformed input is a controlled 400`,()=>appFixture(async app=>{
 const response=await app.inject({method:'POST',url:'/node/'+route,headers:auth,payload:{}});assert.equal(response.statusCode,400);assert.equal(response.json().code,'NODE_INVALID_REQUEST');
}));
const routes=[{method:'GET',url:'/node/list',handler:'list'},{method:'GET',url:'/node/job/fixture',handler:'getJob'},{method:'POST',url:'/node/recover',handler:'recover'},{method:'POST',url:'/node/job/fixture/retry',handler:'retryJob'},{method:'POST',url:'/node/register',handler:'register',payload:registration},{method:'POST',url:'/node/enqueue',handler:'enqueue',payload:dispatch}] as const;
for(const route of routes)test(`NODE-ADMIN-02 ${route.handler} hides service exceptions and returns 503`,async()=>{
 const methods=NodeRegistry.prototype as unknown as Record<string,unknown>,saved=methods[route.handler];methods[route.handler]=async()=>{throw new Error('db password=fixture-private-marker')};
 try{await appFixture(async app=>{const response=await app.inject({method:route.method,url:route.url,headers:auth,payload:'payload' in route?route.payload:undefined});assert.equal(response.statusCode,503);assert.equal(response.json().code,'NODE_SERVICE_UNAVAILABLE');assert.ok(!response.body.includes('fixture-private-marker'));assert.ok(!response.body.includes('password='));})}finally{methods[route.handler]=saved;}
});
test('NODE-ADMIN-03 retry business conflict stays distinct from database unavailability',async()=>{
 const before=process.env.DATABASE_URL;process.env.DATABASE_URL='postgresql://fixture@127.0.0.1:1/never_connect';const pool=db(),query=pool.query;
 (pool as any).query=async()=>({rows:[],rowCount:0});
 try{await appFixture(async app=>{const response=await app.inject({method:'POST',url:'/node/job/fixture/retry',headers:auth});assert.equal(response.statusCode,409);assert.equal(response.json().code,'NODE_RECOVERY_CONFLICT');})}finally{pool.query=query;if(before===undefined)delete process.env.DATABASE_URL;else process.env.DATABASE_URL=before;}
});
test('NODE-ADMIN-04 duplicate registration stays a controlled conflict',async()=>{
 const before=process.env.DATABASE_URL;process.env.DATABASE_URL='postgresql://fixture@127.0.0.1:1/never_connect';const pool=db(),query=pool.query;(pool as any).query=async()=>({rows:[],rowCount:0});
 try{await appFixture(async app=>{const response=await app.inject({method:'POST',url:'/node/register',headers:auth,payload:registration});assert.equal(response.statusCode,409);assert.equal(response.json().code,'NODE_REGISTRATION_CONFLICT');})}finally{pool.query=query;if(before===undefined)delete process.env.DATABASE_URL;else process.env.DATABASE_URL=before;}
});
test('NODE-RATE-01 forwarded headers cannot create new buckets in the current non-trusting proxy configuration',()=>appFixture(async app=>{
 for(let i=0;i<240;i++){const r=await app.inject({method:'POST',url:'/node/heartbeat',headers:{'x-forwarded-for':`198.51.100.${i}`},payload:{}});assert.equal(r.statusCode,401)}
 const response=await app.inject({method:'POST',url:'/node/heartbeat',headers:{'x-forwarded-for':'203.0.113.9'},payload:{}});assert.equal(response.statusCode,429);
}));

test('NODE-ERROR-01 expected domain failures have a fixed, typed HTTP mapping',async()=>{
 const {NodeProtocolError,nodeProtocolFailure}=await import('../src/node-protocol-error.js');
 const expected:Record<string,number>={NODE_INVALID_ID:400,NODE_WORKSPACE_DENIED:403,NODE_REGISTRATION_CONFLICT:409,NODE_RECOVERY_CONFLICT:409,NODE_TARGET_INVALID:400,NODE_NOT_FOUND:404,NODE_QUEUE_BLOCKED:409,NODE_CAPABILITY_UNSUPPORTED:400,NODE_PROJECT_DENIED:403,NODE_PARENT_INVALID:400,NODE_IDEMPOTENCY_INVALID:400,NODE_IDEMPOTENCY_CONFLICT:409,NODE_MISSION_NOT_EXECUTABLE:409,NODE_IDEMPOTENCY_UNRESOLVED:503};
 for(const [code,status] of Object.entries(expected)){let error:Error|undefined;assert.doesNotThrow(()=>{error=new NodeProtocolError(code as any)});const result=nodeProtocolFailure(error);assert.equal(result.statusCode,status);assert.equal(result.code,code);}
});
test('NODE-ERROR-02 a forged typed error cannot emit an arbitrary public label',async()=>{
 const {NodeProtocolError,nodeProtocolFailure}=await import('../src/node-protocol-error.js');
 const forged=Object.assign(Object.create(NodeProtocolError.prototype),{code:'password=private-fixture',message:'private-fixture'});
 const result=nodeProtocolFailure(forged);assert.equal(result.statusCode,503);assert.equal(result.code,'NODE_SERVICE_UNAVAILABLE');assert.ok(!JSON.stringify(result).includes('private-fixture'));
});
