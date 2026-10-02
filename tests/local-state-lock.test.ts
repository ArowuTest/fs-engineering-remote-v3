import test,{afterEach} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {withLocalStateLock} from '../src/local-state-io.js';

const dirs:string[]=[];
afterEach(async()=>{for(const dir of dirs.splice(0))await fs.rm(dir,{recursive:true,force:true})});
test('LOCAL-LOCK-01 stale lock age bounds recovery even if the recorded pid is now alive',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'fs-local-lock-'));dirs.push(dir);const lock=path.join(dir,'state.lock');await fs.mkdir(lock);
 await fs.writeFile(path.join(lock,'owner.json'),JSON.stringify({pid:process.pid,host:os.hostname(),token:'old-owner',acquiredAt:new Date(Date.now()-60000).toISOString()}));
 let entered=false;await withLocalStateLock(lock,async()=>{entered=true},{timeoutMs:300,staleMs:50,pollMs:10});assert.equal(entered,true);
});
