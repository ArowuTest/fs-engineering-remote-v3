import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { buildHttpApp } from '../src/http.js';
import { validateConfig } from '../src/config.js';

const bearer='c'.repeat(48); const endpoint='d'.repeat(48);
async function fixture(){const dir=await fs.mkdtemp(path.join(os.tmpdir(),'fs-compact-'));const config=validateConfig({actionsSecret:bearer,endpointSecret:endpoint,roots:[{name:'work',path:dir}]});return{dir,app:buildHttpApp(config)};}
const headers={authorization:`Bearer ${bearer}`};
async function post(app:any,url:string,payload:any){const r=await app.inject({method:'POST',url,headers,payload});assert.equal(r.statusCode,200,r.body);return r.json();}

test('compact Actions preserve filesystem, process, engineering and memory capabilities',async()=>{const{app}=await fixture();try{
  await post(app,'/actions/fs',{action:'write',root:'work',path:'a.txt',content:'hello'});
  const read=await post(app,'/actions/fs',{action:'read',root:'work',path:'a.txt'});assert.match(read.content,/hello/);
  const run=await post(app,'/actions/process',{action:'run',root:'work',command:'Write-Output compact'});assert.match(run.stdout,/compact/);
  const health=await post(app,'/actions/engineering',{action:'health'});assert.equal(health.ok,true);
  await post(app,'/actions/memory',{action:'write',root:'work',name:'decisions.md',content:'compact memory'});
  const mem=await post(app,'/actions/memory',{action:'read',root:'work',name:'decisions.md'});assert.equal(mem.content,'compact memory');
}finally{await app.close();}});

test('compact OpenAPI exposes seven domain operations while granular backend routes remain compatible',async()=>{const{app}=await fixture();try{
  const schema=await app.inject({method:'GET',url:'/openapi.json'});const doc=schema.json();const ids=Object.values(doc.paths).flatMap((p:any)=>Object.values(p)).map((o:any)=>o.operationId);
  assert.deepEqual(ids.sort(),['browserOperation','engineeringOperation','filesystemOperation','gitOperation','memoryOperation','processOperation','skillOperation'].sort());
  const legacy=await app.inject({method:'GET',url:'/actions/health',headers});assert.equal(legacy.statusCode,200);
}finally{await app.close();}});
