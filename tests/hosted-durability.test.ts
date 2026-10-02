import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs/promises';import os from 'node:os';import path from 'node:path';import {fileURLToPath} from 'node:url';import {spawnSync} from 'node:child_process';

for(const entry of ['index.ts','executor-main.ts'])test(`hosted ${entry} refuses filesystem fallback before starting`,async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'fs-hosted-durability-'));const config=path.join(dir,'fixture-config.json');
 await fs.writeFile(config,JSON.stringify({host:'127.0.0.1',port:0,endpointSecret:'fixture-e-'.padEnd(48,'e'),actionsSecret:'fixture-a-'.padEnd(48,'a'),roots:[{name:'fixture',path:dir}]}));
 const env={...process.env,DATABASE_URL:'',RAILWAY_ENVIRONMENT:'production',FS_REMOTE_HOSTED:'1',FS_REMOTE_STATE_ROOT:path.join(dir,'state'),FS_REMOTE_MCP_CONFIG:config,FS_REMOTE_HOST:'127.0.0.1',PORT:'0',FS_REMOTE_ENDPOINT_SECRET:'fixture-e-'.padEnd(48,'e'),FS_REMOTE_ACTIONS_SECRET:'fixture-a-'.padEnd(48,'a'),OPENROUTER_API_KEY:'',OPENAI_API_KEY:'',NVIDIA_API_KEY:''};
 try{const result=spawnSync(process.execPath,['--import','tsx',fileURLToPath(new URL('../src/'+entry,import.meta.url))],{env,cwd:fileURLToPath(new URL('..',import.meta.url)),encoding:'utf8',timeout:15000});assert.match(result.stderr,/DURABLE_DATABASE_REQUIRED/);assert.equal(result.status,1);assert.equal(result.error,undefined);await assert.rejects(()=>fs.access(path.join(dir,'state')))}finally{await fs.rm(dir,{recursive:true,force:true})}
});

test('durability requirement separates local development from every hosted declaration',async()=>{
 const {requiresDurableState,assertRuntimeDurability}=await import('../src/runtime-durability.js');
 for(const env of [{},{FS_REMOTE_HOSTED:'0'},{FS_REMOTE_HOSTED:'false'}]){assert.equal(requiresDurableState(env),false);assert.doesNotThrow(()=>assertRuntimeDurability(env))}
 for(const env of [{RAILWAY_ENVIRONMENT:'production'},{RAILWAY_ENVIRONMENT_ID:'fixture'},{RAILWAY_PROJECT_ID:'fixture'},{FS_REMOTE_HOSTED:'1'},{FS_REMOTE_HOSTED:'true'}]){assert.equal(requiresDurableState(env),true);assert.throws(()=>assertRuntimeDurability({...env,DATABASE_URL:'  '}),/DURABLE_DATABASE_REQUIRED/);assert.doesNotThrow(()=>assertRuntimeDurability({...env,DATABASE_URL:'postgresql://fixture@127.0.0.1/fixture'}))}
 assert.throws(()=>requiresDurableState({FS_REMOTE_HOSTED:'unexpected'}),/INVALID_HOSTED_FLAG/);
});
