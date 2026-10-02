import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import {validateConfig} from '../src/config.js';
import {ProcessManager} from '../src/processes.js';
import {createRemoteOperations} from '../src/operations.js';

const digest=(s:string)=>crypto.createHash('sha256').update(s).digest('hex');
const replacement="LITERAL:$&:$`:$':$$:$1:$<name>:🌍";
for(const operation of ['edit','patch'] as const)for(const all of [false,true]){
 test(`${operation} inserts literal replacement metacharacters (replaceAll=${all})`,async()=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'fs-literal-edit-'));
  const config=validateConfig({endpointSecret:'fixture-endpoint-'.padEnd(48,'x'),actionsSecret:'fixture-actions-'.padEnd(48,'x'),roots:[{name:'fixture',path:dir}]});
  const ops=createRemoteOperations(config,new ProcessManager({shell:process.platform==='win32'?'powershell.exe':'/bin/sh',maxOutputBytes:10000,stateDir:path.join(dir,'sessions')}));
  // This test checks real path/hash/mutation logic; checkpoint subprocesses are not required.
  (ops as any).trySaveRecoveryCheckpointForPath=async()=>null;
  const original=all?'left NEEDLE middle NEEDLE right':'left NEEDLE right';
  const expected=original.split('NEEDLE').join(replacement);
  const file=path.join(dir,'fixture.txt');
  try{
   await fs.writeFile(file,original);
   const result=operation==='patch'?await ops.patchFile('fixture','fixture.txt',digest(original),'NEEDLE',replacement,all):await ops.editFile('fixture','fixture.txt','NEEDLE',replacement,all);
   assert.equal(await fs.readFile(file,'utf8'),expected);
   assert.equal(result.replacements,all?2:1);
   if(operation==='patch'){
    assert.equal((result as any).afterSha256,digest(expected));
    await assert.rejects(()=>ops.patchFile('fixture','fixture.txt',digest(original),'LITERAL','stale',all),/hash precondition/i);
    assert.equal(await fs.readFile(file,'utf8'),expected);
   }
  }finally{await fs.rm(dir,{recursive:true,force:true})}
 });
}
