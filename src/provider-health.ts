export interface ProviderHealth{provider:string;state:'closed'|'open'|'half_open';failures:number;lastFailureAt?:number;openedAt?:number;lastSuccessAt?:number}
export class ProviderHealthRegistry{
 private readonly states=new Map<string,ProviderHealth>();
 constructor(private readonly failureThreshold=3,private readonly cooldownMs=60000){}
 get(provider:string){const s=this.states.get(provider)??{provider,state:'closed' as const,failures:0};if(s.state==='open'&&s.openedAt&&Date.now()-s.openedAt>=this.cooldownMs){s.state='half_open';this.states.set(provider,s)}return {...s}}
 canUse(provider:string){return this.get(provider).state!=='open'}
 success(provider:string){const s=this.get(provider);s.state='closed';s.failures=0;s.lastSuccessAt=Date.now();s.openedAt=undefined;this.states.set(provider,s);return {...s}}
 failure(provider:string){const s=this.get(provider);s.failures++;s.lastFailureAt=Date.now();if(s.failures>=this.failureThreshold){s.state='open';s.openedAt=Date.now()}this.states.set(provider,s);return {...s}}
 snapshot(){return [...this.states.keys()].map(k=>this.get(k))}
}
