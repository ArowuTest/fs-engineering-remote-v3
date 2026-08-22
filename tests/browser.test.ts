import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { BrowserManager } from '../src/browser.js';

test('governed browser completes UI, console, network and screenshot lifecycle', async (t) => {
  const manager=new BrowserManager(); const browsers=await manager.availableBrowsers();
  if(!browsers.length){t.skip('Chrome/Edge unavailable');return;}
  const server=http.createServer((req,res)=>{
    res.setHeader('content-type','text/html');
    res.end(`<!doctype html><title>FS Browser Test</title><input id="name"><button id="go" onclick="console.log('clicked:'+document.querySelector('#name').value);document.querySelector('#out').textContent='Hello '+document.querySelector('#name').value">Go</button><div id="out"></div>`);
  });
  await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
  const address=server.address(); if(!address||typeof address==='string')throw new Error('bad address');
  let id:number|undefined;
  try{
    const started=await manager.start({headless:true});id=started.sessionId;
    const nav=await manager.navigate(id,`http://127.0.0.1:${address.port}/`);assert.equal(nav.status,200);assert.equal(nav.title,'FS Browser Test');
    await manager.type(id,'#name','Engineer');await manager.click(id,'#go');
    const snap=await manager.snapshot(id);assert.match(snap.text,/Hello Engineer/);
    const console=manager.console(id);assert.ok(console.entries.some(x=>x.text==='clicked:Engineer'));
    const network=manager.network(id);assert.ok(network.entries.some(x=>x.status===200));
    await manager.viewport(id,375,812);const a11y=await manager.accessibility(id);assert.ok(Array.isArray(a11y.violations));
    const perf=await manager.performance(id);assert.equal(typeof perf.resourceCount,'number');
    const shot=await manager.screenshot(id);assert.equal(shot.mimeType,'image/png');assert.ok(shot.bytes>100);
  } finally { if(id)await manager.close(id); await new Promise<void>(resolve=>server.close(()=>resolve())); }
});

test('browser navigation rejects non-http protocols',async(t)=>{const manager=new BrowserManager();const browsers=await manager.availableBrowsers();if(!browsers.length){t.skip();return;}const s=await manager.start();try{await assert.rejects(()=>manager.navigate(s.sessionId,'file:///C:/Windows/win.ini'),/http\/https/i);}finally{await manager.close(s.sessionId);}});
