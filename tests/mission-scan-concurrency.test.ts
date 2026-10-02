import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import ts from 'typescript';

// Execute the actual production scan function with only its I/O dependencies replaced.
// This avoids starting the real entrypoint, migrations, timers or provider calls.
async function scanner(ready:()=>Promise<void>){
 const source=await fs.readFile(new URL('../src/executor-main.ts',import.meta.url),'utf8');
 const start=source.indexOf('async function scanMissions()'),end=source.indexOf('\nconst scanner',start);
 assert.ok(start>=0&&end>start,'production scanner boundary must remain explicit');
 const code=ts.transpileModule(source.slice(start,end),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.None}}).outputText;
 const active=new Map<string,Promise<unknown>>(),evidence:any[]=[];let starts=0;
 const missions={list:async()=>[{id:'m',workspaceId:'w',status:'running',currentStepId:'s'}],addEvidence:async(x:any)=>{evidence.push(x)}};
 const scan=new Function('missions','activeMissions','ensureReviewerReadiness','supervisor','console',code+'\nreturn scanMissions;')(missions,active,ready,{runMission:async()=>{starts++;return{completed:true}}},{error:()=>{}});
 return {scan,active,evidence,starts:()=>starts};
}

test('overlapping mission scans reserve one supervisor before asynchronous readiness',async()=>{
 let release!:()=>void;const gate=new Promise<void>(r=>{release=r});
 const fixture=await scanner(()=>gate);
 const first=fixture.scan(),second=fixture.scan();
 await new Promise(r=>setImmediate(r));release();
 await Promise.all([first,second]);await Promise.all(fixture.active.values());
 assert.equal(fixture.starts(),1,'the same mission must not start two supervisor loops');
 assert.equal(fixture.active.size,0);
});

test('readiness failure is recorded without raw private exception text and releases the reservation',async()=>{
 const marker='PRIVATE_SCAN_EXCEPTION_FIXTURE';
 const fixture=await scanner(async()=>{throw new Error(marker)});
 await assert.doesNotReject(()=>fixture.scan());
 await Promise.all(fixture.active.values());
 assert.equal(fixture.starts(),0);
 assert.equal(fixture.active.size,0);
 assert.equal(fixture.evidence.length,1);
 assert.equal(fixture.evidence[0].workspaceId,'w');
 assert.equal(fixture.evidence[0].status,'fail');
 assert.ok(!JSON.stringify(fixture.evidence).includes(marker));
});
