import test from 'node:test';
import assert from 'node:assert/strict';
import { PersistentExecutor } from '../src/executor.js';

test('idle executor schedules exactly one next poll per tick', async () => {
  const originalSetTimeout=globalThis.setTimeout;
  const scheduled:Array<()=>void>=[];
  (globalThis as any).setTimeout=(fn:()=>void)=>{scheduled.push(fn);return {unref(){}} as any};
  try{
    const queue:any={recover:async()=>({}),claim:async()=>null};
    const missions:any={addEvidence:async()=>({})};
    const identity:any={instanceId:'test',instanceName:'test',stateRoot:'.',host:'host',pid:1,startedAt:new Date().toISOString()};
    const executor=new PersistentExecutor(identity,queue,missions,2000,120000);
    executor.register('noop',async()=>({}));
    await executor.start();
    assert.equal(scheduled.length,1,'start schedules the initial tick');
    const first=scheduled.shift()!;
    await first();
    await new Promise(resolve=>originalSetTimeout(resolve,0));
    assert.equal(scheduled.length,1,'an idle tick must schedule only one successor');
    await executor.stop();
  }finally{(globalThis as any).setTimeout=originalSetTimeout}
});
