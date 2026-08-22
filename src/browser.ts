import { chromium, type Browser, type BrowserContext, type Page, type Request, type Response } from 'playwright-core';
import fs from 'node:fs/promises';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

export type BrowserConsoleEntry = { type: string; text: string; timestamp: string };
export type BrowserNetworkEntry = { method: string; url: string; resourceType: string; status?: number; failure?: string; timestamp: string };

type Session = {
  id: number; browser: Browser; context: BrowserContext; page: Page; executablePath: string;
  console: BrowserConsoleEntry[]; network: BrowserNetworkEntry[];
};

const BROWSER_PATHS = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
];

export class BrowserManager {
  private sessions = new Map<number, Session>();
  private nextId = 1;

  async availableBrowsers() {
    const found: string[] = [];
    for (const p of BROWSER_PATHS) { try { await fs.access(p); found.push(p); } catch { /* absent */ } }
    return found;
  }

  async start(opts: { headless?: boolean; executablePath?: string } = {}) {
    const available = await this.availableBrowsers();
    const executablePath = opts.executablePath ?? available[0];
    if (!executablePath || !available.includes(executablePath)) throw new Error('No approved Chrome/Edge executable is available.');
    const browser = await chromium.launch({ executablePath, headless: opts.headless ?? true });
    const context = await browser.newContext();
    const page = await context.newPage();
    const session: Session = { id: this.nextId++, browser, context, page, executablePath, console: [], network: [] };
    page.on('console', msg => session.console.push({ type: msg.type(), text: msg.text(), timestamp: new Date().toISOString() }));
    page.on('request', (req: Request) => session.network.push({ method: req.method(), url: req.url(), resourceType: req.resourceType(), timestamp: new Date().toISOString() }));
    page.on('response', (res: Response) => { const e=[...session.network].reverse().find(x=>x.url===res.url() && x.status===undefined); if(e)e.status=res.status(); });
    page.on('requestfailed', req => { const e=[...session.network].reverse().find(x=>x.url===req.url() && x.failure===undefined); if(e)e.failure=req.failure()?.errorText ?? 'request failed'; });
    this.sessions.set(session.id, session);
    return { sessionId: session.id, executablePath, headless: opts.headless ?? true };
  }

  private get(id: number) { const s=this.sessions.get(id); if(!s) throw new Error(`Unknown browser session ${id}.`); return s; }
  async navigate(id: number, url: string, waitUntil: 'load'|'domcontentloaded'|'networkidle' = 'domcontentloaded') {
    if (!/^https?:\/\//i.test(url)) throw new Error('Browser navigation only supports http/https URLs.');
    const s=this.get(id); const response=await s.page.goto(url,{waitUntil,timeout:30000});
    return { url:s.page.url(), title:await s.page.title(), status:response?.status() ?? null };
  }
  async snapshot(id: number) {
    const p=this.get(id).page;
    return { url:p.url(), title:await p.title(), text:(await p.locator('body').innerText()).slice(0,100000), html:(await p.locator('body').innerHTML()).slice(0,200000) };
  }
  async click(id:number, selector:string){const p=this.get(id).page;await p.locator(selector).click({timeout:15000});return {ok:true,url:p.url()};}
  async type(id:number, selector:string, value:string, pressEnter=false){const p=this.get(id).page;await p.locator(selector).fill(value,{timeout:15000});if(pressEnter)await p.locator(selector).press('Enter');return {ok:true,url:p.url()};}
  async wait(id:number, selector?:string, timeoutMs=5000){const p=this.get(id).page;if(selector)await p.locator(selector).waitFor({timeout:timeoutMs});else await p.waitForTimeout(timeoutMs);return {ok:true,url:p.url()};}
  console(id:number, cursor=0){const s=this.get(id);return {entries:s.console.slice(cursor),nextCursor:s.console.length};}
  network(id:number, cursor=0){const s=this.get(id);return {entries:s.network.slice(cursor),nextCursor:s.network.length};}
  async screenshot(id:number){const p=this.get(id).page;const bytes=await p.screenshot({fullPage:true,type:'png'});return {mimeType:'image/png',base64:bytes.toString('base64'),bytes:bytes.length,url:p.url()};}
  async viewport(id:number,width:number,height:number){const p=this.get(id).page;await p.setViewportSize({width,height});return{ok:true,width,height,url:p.url()};}
  async accessibility(id:number){
    const p=this.get(id).page;
    const source=await fs.readFile(require.resolve('axe-core/axe.min.js'),'utf8');
    await p.addScriptTag({content:source});
    const result=await p.evaluate(async()=>await (globalThis as any).axe.run(document,{runOnly:{type:'tag',values:['wcag2a','wcag2aa','wcag21aa','wcag22aa']}}));
    return {url:p.url(),violations:result.violations.map((v:any)=>({id:v.id,impact:v.impact,description:v.description,help:v.help,nodes:v.nodes.map((n:any)=>({target:n.target,html:n.html,failureSummary:n.failureSummary}))})),passes:result.passes.length,incomplete:result.incomplete.length};
  }
  async performance(id:number){
    const p=this.get(id).page;
    return await p.evaluate(()=>{const nav=performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming|undefined;const paints=Object.fromEntries(performance.getEntriesByType('paint').map((x:any)=>[x.name,Math.round(x.startTime)]));const resources=performance.getEntriesByType('resource') as PerformanceResourceTiming[];return{url:location.href,domContentLoadedMs:nav?Math.round(nav.domContentLoadedEventEnd):null,loadMs:nav?Math.round(nav.loadEventEnd):null,transferBytes:resources.reduce((n,r)=>n+(r.transferSize||0),0),resourceCount:resources.length,paints};});
  }
  async close(id:number){const s=this.get(id);await s.browser.close();this.sessions.delete(id);return {closed:true,sessionId:id};}
  async closeAll(){for(const id of [...this.sessions.keys()]){try{await this.close(id);}catch{/* best effort */}}}
}
