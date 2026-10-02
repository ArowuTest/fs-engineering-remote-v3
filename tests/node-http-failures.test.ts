import test from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import {NodeRegistry} from '../src/nodes.js';
import {registerNodeRoutes} from '../src/node-http.js';
import {validateConfig} from '../src/config.js';

const headers={'x-fs-node-id':'fixture-node','x-fs-node-secret':'fixture-node-secret'};
const bodies:Record<string,Record<string,unknown>>={heartbeat:{},claim:{},renew:{jobId:'fixture-job',leaseToken:'t'.repeat(24)},complete:{jobId:'fixture-job',leaseToken:'t'.repeat(24),result:{}}};
async function fixture(run:(app:ReturnType<typeof Fastify>)=>Promise<void>,options:{identityError?:boolean;noIdentity?:boolean;notReady?:boolean;revoked?:boolean;actionsSecret?:string;missingSecret?:boolean}={}){
 const oldResolve=NodeRegistry.resolveIdentity,oldAuth=NodeRegistry.prototype.authenticate,oldList=NodeRegistry.prototype.list;
 const config=validateConfig({endpointSecret:'e'.repeat(48),actionsSecret:'a'.repeat(48),roots:[{name:'fixture',path:process.cwd()}]});
 if(options.missingSecret)(config as any).actionsSecret=undefined;
 NodeRegistry.resolveIdentity=async()=>{if(options.identityError)throw new Error('database connection failed password=fixture-sensitive-do-not-return');return options.noIdentity?null:{nodeId:'fixture-node',workspaceId:'workspace-a'};};
 NodeRegistry.prototype.authenticate=async()=>options.revoked?null:{id:'fixture-node',workspace_id:'workspace-a',metadata:{readiness:{ok:!options.notReady}}};
 NodeRegistry.prototype.list=async()=>[];
 const app=Fastify();registerNodeRoutes(app,config);
 try{await run(app);}finally{await app.close();NodeRegistry.resolveIdentity=oldResolve;NodeRegistry.prototype.authenticate=oldAuth;NodeRegistry.prototype.list=oldList;}
}
for(const route of Object.keys(bodies))test(`NODE-HTTP-01 ${route} database failure is unavailable, not credential rejection or leaked exception`,()=>fixture(async app=>{
 const response=await app.inject({method:'POST',url:'/node/'+route,headers,payload:bodies[route]});
 assert.equal(response.statusCode,503);assert.equal(response.json().code,'NODE_SERVICE_UNAVAILABLE');assert.ok(!response.body.includes('fixture-sensitive'));assert.ok(!response.body.includes('password='));
},{identityError:true}));
for(const route of Object.keys(bodies))test(`NODE-HTTP-02 ${route} malformed body reports invalid request`,()=>fixture(async app=>{
 const response=await app.inject({method:'POST',url:'/node/'+route,headers,payload:{unexpected:true}});
 assert.equal(response.statusCode,400);assert.equal(response.json().code,'NODE_INVALID_REQUEST');
}));
for(const route of Object.keys(bodies))test(`NODE-HTTP-03 ${route} invalid credential remains unauthorized`,()=>fixture(async app=>{
 const response=await app.inject({method:'POST',url:'/node/'+route,headers,payload:bodies[route]});assert.equal(response.statusCode,401);
},{noIdentity:true}));
test('NODE-HTTP-04 blocked readiness is a lifecycle conflict, not an authentication failure',()=>fixture(async app=>{
 const response=await app.inject({method:'POST',url:'/node/claim',headers,payload:{}});assert.equal(response.statusCode,409);assert.equal(response.json().code,'NODE_NOT_READY');
},{notReady:true}));
test('NODE-HTTP-05 credential lost between identity lookup and lease renewal is unauthorized',()=>fixture(async app=>{
 const response=await app.inject({method:'POST',url:'/node/renew',headers,payload:bodies.renew});assert.equal(response.statusCode,401);
},{revoked:true}));
test('NODE-HTTP-06 an unset admin secret cannot authorize the literal Bearer undefined',()=>fixture(async app=>{
 const response=await app.inject({method:'GET',url:'/node/list',headers:{authorization:'Bearer undefined'}});assert.equal(response.statusCode,401);
},{missingSecret:true}));
test('NODE-HTTP-07 configured admin authentication still works',()=>fixture(async app=>{
 const response=await app.inject({method:'GET',url:'/node/list',headers:{authorization:'Bearer '+'a'.repeat(48)}});assert.equal(response.statusCode,200);assert.deepEqual(response.json(),[]);
}));
