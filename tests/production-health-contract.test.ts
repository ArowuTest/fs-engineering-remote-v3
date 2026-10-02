import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {buildHttpApp} from '../src/http.js';
import {validateConfig} from '../src/config.js';

test('hosted health fails closed when durable database is absent',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'fs-health-contract-'));
 const names=['DATABASE_URL','RAILWAY_ENVIRONMENT','RAILWAY_ENVIRONMENT_ID','RAILWAY_PROJECT_ID','FS_REMOTE_HOSTED','FS_REMOTE_STATE_ROOT','FS_REMOTE_INSTANCE_ID'] as const;
 const saved=new Map(names.map(name=>[name,process.env[name]]));
 let app:ReturnType<typeof buildHttpApp>|undefined;
 try{
  for(const name of names)delete process.env[name];
  process.env.FS_REMOTE_STATE_ROOT=path.join(dir,'runtime');process.env.FS_REMOTE_INSTANCE_ID='health-fixture';
  app=buildHttpApp(validateConfig({endpointSecret:'fixture-health-endpoint-'.padEnd(48,'e'),actionsSecret:'fixture-health-actions-'.padEnd(48,'a'),roots:[{name:'fixture',path:dir}]}));
  const markers=['RAILWAY_ENVIRONMENT','RAILWAY_ENVIRONMENT_ID','RAILWAY_PROJECT_ID','FS_REMOTE_HOSTED'] as const;
  const scenarios:Array<Record<string,string>>=[{}, {RAILWAY_ENVIRONMENT:'production'}, {RAILWAY_ENVIRONMENT_ID:'fixture'}, {RAILWAY_PROJECT_ID:'fixture'}, {FS_REMOTE_HOSTED:'1'}, {FS_REMOTE_HOSTED:'true'}];
  for(const marker of scenarios){
   for(const name of markers)delete process.env[name];Object.assign(process.env,marker);
   const hosted=Object.keys(marker).length>0;
   type InjectedHealth={statusCode:number;json():{database:{configured:boolean};durableRequired:boolean;ok?:boolean;ready?:boolean}};
   const health:InjectedHealth=await app.inject({method:'GET',url:'/healthz'});
   const ready:InjectedHealth=await app.inject({method:'GET',url:'/readyz'});
   assert.equal(health.statusCode,200);assert.equal(health.json().database.configured,false);
   assert.equal(health.json().durableRequired,hosted);assert.equal(health.json().ok,!hosted);
   assert.equal(ready.statusCode,hosted?503:200);assert.equal(ready.json().ready,!hosted);
   assert.equal(ready.json().durableRequired,hosted);
  }
 }finally{
  if(app)await app.close();
  for(const name of names){const value=saved.get(name);if(value===undefined)delete process.env[name];else process.env[name]=value}
  await fs.rm(dir,{recursive:true,force:true});
 }
});
