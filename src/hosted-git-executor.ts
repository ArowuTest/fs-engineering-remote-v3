import {assertOptionalExecutionReleased} from './execution-release.js';
import {sanitizedCommandEnvironment} from './processes.js';
import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

const execFileAsync=promisify(execFile);
export interface HostedGitJob { repository:string; branch:string; base?:string; commitMessage:string; files:Record<string,string>; verify?:string[]; expectedRemoteHead?:string; }
export interface HostedGitResult { repository:string; branch:string; commit:string; verification:Array<{command:string;ok:boolean;output:string}>; changed:string[]; }
function allowedRepo(repo:string){const allow=(process.env.FS_HOSTED_GIT_REPOSITORIES??'ArowuTest/fs-engineering-remote-v3').split(',').map(x=>x.trim().toLowerCase()).filter(Boolean);if(!allow.includes(repo.toLowerCase()))throw new Error(`Repository '${repo}' is not allowed.`)}
function allowedBranch(branch:string){if(!/^(feature|fix|review)\/[A-Za-z0-9._/-]+$/.test(branch)||branch==='main'||branch==='master')throw new Error(`Branch '${branch}' is not an allowed hosted engineering branch.`)}
function safeFile(file:string){const n=file.replace(/\\/g,'/');if(!n||n.startsWith('/')||n.includes('../')||n==='.git'||n.startsWith('.git/'))throw new Error(`Unsafe workspace path '${file}'.`);return n}
function safeVerify(command:string){if(!/^(npm (test|run (check|test|lint|build))|npx tsc --noEmit)$/.test(command.trim()))throw new Error(`Verification command is not allow-listed: ${command}`);return command.trim()}
function repositoryUrl(repo:string){return `https://github.com/${repo}.git`}
function gitAuthEnvironment(token:string):NodeJS.ProcessEnv{return sanitizedCommandEnvironment({GIT_CONFIG_COUNT:'1',GIT_CONFIG_KEY_0:'http.https://github.com/.extraheader',GIT_CONFIG_VALUE_0:`AUTHORIZATION: basic ${Buffer.from(`x-access-token:${token}`).toString('base64')}`})}
async function run(cwd:string,cmd:string,args:string[],env:NodeJS.ProcessEnv=sanitizedCommandEnvironment()){const r=await execFileAsync(cmd,args,{cwd,env,maxBuffer:8*1024*1024,timeout:10*60_000});return `${r.stdout??''}${r.stderr??''}`.slice(-20000)}
export class HostedGitExecutor {
 async execute(job:HostedGitJob):Promise<HostedGitResult>{
  allowedRepo(job.repository);allowedBranch(job.branch);if(!job.commitMessage?.trim())throw new Error('commitMessage is required.');
  assertOptionalExecutionReleased('hosted');
  const token=process.env.GITHUB_TOKEN;if(!token)throw new Error('GITHUB_TOKEN is not configured.');
  const authEnv=gitAuthEnvironment(token),cleanRemote=repositoryUrl(job.repository),root=await fs.mkdtemp(path.join(os.tmpdir(),'fs-hosted-git-')),repoDir=path.join(root,'repo');
  try{
   await run(root,'git',['clone','--depth','50',cleanRemote,repoDir],authEnv);
   await run(repoDir,'git',['remote','set-url','origin',cleanRemote]);
   const base=job.base??'main';await run(repoDir,'git',['fetch','origin',base,job.branch],authEnv);
   if(job.expectedRemoteHead){let actual='';try{actual=(await run(repoDir,'git',['rev-parse',`origin/${job.branch}`])).trim()}catch{}if(actual!==job.expectedRemoteHead)throw new Error(`Remote branch moved: expected ${job.expectedRemoteHead}, found ${actual||'missing'}.`)}
   try{await run(repoDir,'git',['checkout',job.branch])}catch{await run(repoDir,'git',['checkout','-b',job.branch,`origin/${base}`])}
   for(const [name,content] of Object.entries(job.files)){const rel=safeFile(name),target=path.join(repoDir,rel);await fs.mkdir(path.dirname(target),{recursive:true});await fs.writeFile(target,content,'utf8')}
   const verification=[] as HostedGitResult['verification'];for(const raw of job.verify??['npm run check','npm test']){const command=safeVerify(raw);try{const [bin,...args]=command.split(' ');verification.push({command,ok:true,output:await run(repoDir,bin,args)})}catch(e:any){verification.push({command,ok:false,output:String(e?.stdout??e?.stderr??e?.message??e).slice(-20000)});throw new Error(`Verification failed: ${command}`)}}
   const changed=(await run(repoDir,'git',['status','--porcelain'])).split(/\r?\n/).filter(Boolean);if(!changed.length)return {repository:job.repository,branch:job.branch,commit:(await run(repoDir,'git',['rev-parse','HEAD'])).trim(),verification,changed:[]};
   await run(repoDir,'git',['config','user.name','FS Engineering Worker']);await run(repoDir,'git',['config','user.email','fs-engineering-worker@users.noreply.github.com']);await run(repoDir,'git',['add','--all']);await run(repoDir,'git',['commit','-m',job.commitMessage]);
   const commit=(await run(repoDir,'git',['rev-parse','HEAD'])).trim();await run(repoDir,'git',['push','--force-with-lease',job.expectedRemoteHead?`refs/heads/${job.branch}:${job.expectedRemoteHead}`:`refs/heads/${job.branch}`, 'origin',`HEAD:refs/heads/${job.branch}`],authEnv);return {repository:job.repository,branch:job.branch,commit,verification,changed};
  }finally{await fs.rm(root,{recursive:true,force:true,maxRetries:8,retryDelay:100})}
 }
}
