import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const delay=(ms:number)=>new Promise(resolve=>setTimeout(resolve,ms));
interface LockOwner{pid:number;host:string;token:string;acquiredAt:string}

async function owner(lockDir:string):Promise<LockOwner|null>{
 try{
  const raw=JSON.parse(await fs.readFile(path.join(lockDir,'owner.json'),'utf8'));
  return raw&&Number.isInteger(raw.pid)&&typeof raw.host==='string'&&typeof raw.token==='string'&&typeof raw.acquiredAt==='string'?raw:null;
 }catch{return null}
}
function pidAlive(pid:number){
 try{process.kill(pid,0);return true}
 catch(error){return (error as NodeJS.ErrnoException).code!=='ESRCH'}
}
async function stale(lockDir:string,staleMs:number){
 let stat;try{stat=await fs.stat(lockDir)}catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return false;throw error}
 const current=await owner(lockDir),at=current?Date.parse(current.acquiredAt):stat.mtimeMs,expired=Number.isFinite(at)&&Date.now()-at>staleMs;
 if(current?.host===os.hostname()&&Number.isInteger(current.pid))return !pidAlive(current.pid)||expired;
 return expired;
}
async function reclaim(lockDir:string){
 const quarantine=lockDir+'.stale-'+process.pid+'-'+crypto.randomBytes(6).toString('hex');
 try{await fs.rename(lockDir,quarantine)}catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return false;return false}
 await fs.rm(quarantine,{recursive:true,force:true});return true;
}
export async function withLocalStateLock<T>(lockDir:string,run:()=>Promise<T>,options:{timeoutMs?:number;staleMs?:number;pollMs?:number}={}):Promise<T>{
 const timeoutMs=options.timeoutMs??10000,staleMs=options.staleMs??120000,pollMs=options.pollMs??20,deadline=Date.now()+timeoutMs;
 await fs.mkdir(path.dirname(lockDir),{recursive:true});
 const token=crypto.randomBytes(16).toString('hex'),mine:LockOwner={pid:process.pid,host:os.hostname(),token,acquiredAt:new Date().toISOString()};
 for(;;){
  try{
   await fs.mkdir(lockDir);
   try{await fs.writeFile(path.join(lockDir,'owner.json'),JSON.stringify(mine),'utf8')}catch(error){await fs.rm(lockDir,{recursive:true,force:true});throw error}
   break;
  }catch(error){
   const code=(error as NodeJS.ErrnoException).code;
   const contended=code==='EEXIST'||(process.platform==='win32'&&(code==='EPERM'||code==='EBUSY'));
   if(!contended)throw error;
   if(await stale(lockDir,staleMs)){await reclaim(lockDir);continue}
   if(Date.now()>=deadline)throw new Error('LOCAL_STATE_LOCK_TIMEOUT: another process is mutating local state.');
   await delay(pollMs);
  }
 }
 try{return await run()}
 finally{
  const current=await owner(lockDir);
  if(current?.token===token)await fs.rm(lockDir,{recursive:true,force:true});
 }
}
export async function atomicWriteText(file:string,text:string){
 await fs.mkdir(path.dirname(file),{recursive:true});
 const temp=path.join(path.dirname(file),'.'+path.basename(file)+'.tmp-'+process.pid+'-'+crypto.randomBytes(8).toString('hex'));
 try{await fs.writeFile(temp,text,{encoding:'utf8',flag:'wx'});await fs.rename(temp,file)}
 catch(error){await fs.rm(temp,{force:true});throw error}
}
export async function atomicWriteJson(file:string,value:unknown){return atomicWriteText(file,JSON.stringify(value,null,2))}
