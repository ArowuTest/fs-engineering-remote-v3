export type ExecutionTarget='local'|'sandbox'|'hosted';
export interface SandboxProviderStatus{provider:'opensandbox';enabled:boolean;configured:boolean;healthy:boolean;endpoint?:string;reason?:string}
export class OpenSandboxProvider{
 private endpoint=(process.env.FS_OPENSANDBOX_URL??'').replace(/\/$/,''); private key=process.env.FS_OPENSANDBOX_API_KEY??'';
 configured(){return !!this.endpoint}
 async status():Promise<SandboxProviderStatus>{if(!this.endpoint)return{provider:'opensandbox',enabled:false,configured:false,healthy:false,reason:'FS_OPENSANDBOX_URL is not configured.'};try{const r=await fetch(this.endpoint+'/health',{headers:this.key?{'authorization':`Bearer ${this.key}`}:{},signal:AbortSignal.timeout(5000)});return{provider:'opensandbox',enabled:true,configured:true,healthy:r.ok,endpoint:this.endpoint,reason:r.ok?undefined:`Health HTTP ${r.status}`}}catch(e){return{provider:'opensandbox',enabled:true,configured:true,healthy:false,endpoint:this.endpoint,reason:e instanceof Error?e.message:String(e)}}}
 capabilities(){return{provider:'opensandbox',configured:this.configured(),defaultTarget:'local' as const,supportedTargets:['local','sandbox','hosted'] as ExecutionTarget[],policy:'Sandbox is opt-in. Local execution remains the default; repository upload and credentials require explicit job policy.'}}
}
