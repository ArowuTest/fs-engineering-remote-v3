import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {ProcessManager} from './processes.js';
import {platformContract,type SupportedNodePlatform} from './platform-contract.js';
const exec=promisify(execFile);
export type NodeDoctorStatus='pass'|'warn'|'fail';
export interface NodeDoctorCheck{name:string;status:NodeDoctorStatus;durationMs:number;details:string}
export interface NodeDoctorReport{schemaVersion:'fs.node.doctor.v1';ok:boolean;platform:SupportedNodePlatform;arch:string;node:string;hostname:string;shell:string;requiredChecks:string[];checks:NodeDoctorCheck[]}
function defaultShell(platform:SupportedNodePlatform){return platform==='win32'?'powershell.exe':platform==='darwin'?'/bin/zsh':'/bin/bash'}
async function timed(name:string,fn:()=>Promise<string>):Promise<NodeDoctorCheck>{const started=performance.now();try{const details=await fn();return{name,status:'pass',durationMs:performance.now()-started,details}}catch(e){return{name,status:'fail',durationMs:performance.now()-started,details:e instanceof Error?e.message:String(e)}}}
async function waitForExit(pm:ProcessManager,pid:number,timeoutMs=5000){const deadline=Date.now()+timeoutMs;let cursor=0,output='';for(;;){const x=pm.read(pid,cursor);cursor=x.nextCursor;output+=x.output;if(!x.alive)return{x,output};if(Date.now()>=deadline){pm.stop(pid);throw new Error('durable execution did not finish before timeout');}await new Promise(r=>setTimeout(r,50))}}
export async function runNodeDoctor(input:{platform?:NodeJS.Platform;shell?:string}={}):Promise<NodeDoctorReport>{const contract=platformContract(input.platform??process.platform),shell=input.shell??defaultShell(contract.platform),checks:NodeDoctorCheck[]=[],tmp=await fs.mkdtemp(path.join(os.tmpdir(),'fs-node-doctor-')),pm=new ProcessManager({shell,maxOutputBytes:256*1024,stateDir:path.join(tmp,'sessions')});try{
checks.push(await timed('paths',async()=>{const f=path.join(tmp,'fs-doctor.txt');await fs.writeFile(f,'ok','utf8');const x=await fs.readFile(f,'utf8');if(x!=='ok')throw new Error('filesystem round-trip mismatch');return `temp=${tmp}`}));
checks.push(await timed('git',async()=>{const r=await exec('git',['--version'],{cwd:tmp});const v=r.stdout.trim();if(!/^git version /i.test(v))throw new Error(`unexpected git response: ${v}`);return v}));
checks.push(await timed('shell-spawn',async()=>{const r=await pm.run("node -e \"process.stdout.write('FS_NODE_DOCTOR_OK')\"",tmp,10000);if(r.exitCode!==0||r.stdout!=='FS_NODE_DOCTOR_OK')throw new Error(`shell execution failed exit=${r.exitCode} stderr=${r.stderr.trim()}`);return `${shell}: ok`}));
checks.push(await timed('command-env',async()=>{const r=await pm.run("node -e \"process.stdout.write(process.execPath)\"",tmp,10000);if(r.exitCode!==0||!r.stdout.trim())throw new Error(`command environment failed exit=${r.exitCode}`);return r.stdout.trim()}));
checks.push(await timed('durable-exec',async()=>{const x=pm.start("node -e \"setTimeout(()=>console.log('FS_DURABLE_OK'),100)\"",tmp),done=await waitForExit(pm,x.processId);if(done.x.exitCode!==0||!done.output.includes('FS_DURABLE_OK'))throw new Error(`durable execution failed exit=${done.x.exitCode}`);return `session=${x.sessionId}`}));
checks.push(await timed(contract.platform==='win32'?'cancel-tree':'signals',async()=>{const x=pm.start("node -e \"setTimeout(()=>{},10000)\"",tmp);await new Promise(r=>setTimeout(r,100));if(!pm.stop(x.processId))throw new Error('failed to cancel child process');return `process=${x.processId} cancelled`}));
checks.push(await timed('mcp',async()=>{const mod=await import('@modelcontextprotocol/client');if(typeof mod.Client!=='function')throw new Error('MCP client package is unavailable');const loopback=await new Promise<string>((resolve,reject)=>{const server=net.createServer();server.once('error',reject);server.listen(0,'127.0.0.1',()=>{const a=server.address();server.close(e=>e?reject(e):resolve(`loopback=${typeof a==='object'&&a?a.port:'unknown'}`))})});return `client=available ${loopback}`}));
}finally{await new Promise(r=>setTimeout(r,150));await fs.rm(tmp,{recursive:true,force:true,maxRetries:20,retryDelay:100})}const required=new Set(contract.requiredChecks),present=new Set(checks.map(x=>x.name));for(const name of required)if(!present.has(name))checks.push({name,status:'fail',durationMs:0,details:'required platform check not implemented by node doctor'});return{schemaVersion:'fs.node.doctor.v1',ok:checks.every(x=>x.status!=='fail'),platform:contract.platform,arch:process.arch,node:process.version,hostname:os.hostname(),shell,requiredChecks:contract.requiredChecks,checks}}
