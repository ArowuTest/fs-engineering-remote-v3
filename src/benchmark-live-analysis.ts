export interface LiveCall{wallMs:number;bytes:number;name:string}
export interface LiveRun{profile:string;calls:LiveCall[];totalWallMs:number;totalResponseBytes:number}
const median=(xs:number[])=>{const s=[...xs].sort((a,b)=>a-b);return s.length?s[Math.floor(s.length/2)]:0};
export function analyzeLiveRuns(xs:LiveRun[]){const groups=new Map<string,LiveRun[]>();for(const x of xs){const g=groups.get(x.profile)??[];g.push(x);groups.set(x.profile,g)}return[...groups].map(([profile,runs])=>({profile,runs:runs.length,medianWallMs:median(runs.map(x=>x.totalWallMs)),medianResponseBytes:median(runs.map(x=>x.totalResponseBytes)),medianCalls:median(runs.map(x=>x.calls.length)),medianPerCallMs:median(runs.flatMap(x=>x.calls.map(c=>c.wallMs)))}))}
export function relativeImprovement(baseline:number,candidate:number){return baseline>0?(baseline-candidate)/baseline:0}
