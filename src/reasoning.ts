import {ReasoningFailure,reasoningFailure,responseFailure} from './reasoning-errors.js';
import {ProviderHealthRegistry} from './provider-health.js';
export interface ReasoningRequest{system:string;prompt:string;model?:string;temperature?:number;maxTokens?:number;signal?:AbortSignal;timeoutMs?:number;costClass?:'free'|'paid'}
export interface ReasoningResponse{provider:string;model:string;text:string;usage?:Record<string,unknown>;requestId?:string}
export interface ReasoningProvider{complete(req:ReasoningRequest):Promise<ReasoningResponse>}
let health=new ProviderHealthRegistry(3,60000);
const cooldowns=new Map<string,{until:number;kind:string;scope:'model'|'provider'|'paid_provider'}>();
const MAX_COOLDOWNS=4096;let overflowUntil=0;
export function reasoningTransportStats(){return{cooldownEntries:cooldowns.size,overflowUntil}}
function pruneCooldowns(){const now=Date.now();for(const[k,c]of cooldowns)if(c.until<=now)cooldowns.delete(k)}
export function resetReasoningHealth(){health=new ProviderHealthRegistry(3,60000);cooldowns.clear();overflowUntil=0}
async function jsonRequest(provider:string,url:string,apiKey:string|undefined,body:Record<string,unknown>,headers:Record<string,string>={},request:ReasoningRequest){
 const model=String(body.model??'');
 if(!apiKey)throw new ReasoningFailure('provider_not_configured','provider',true,undefined,0,provider,model);
 request.signal?.throwIfAborted();pruneCooldowns();
 if(overflowUntil>Date.now())throw new ReasoningFailure('transport_capacity_cooldown','request',false,undefined,overflowUntil-Date.now(),provider,model);
 const keys=[provider,`${provider}::${model}`,...(request.costClass!=='free'?[`${provider}:paid`]:[])];
 for(const key of keys){const c=cooldowns.get(key);if(c&&c.until>Date.now())throw new ReasoningFailure(c.kind,c.scope,true,undefined,c.until-Date.now(),provider,model);if(c)cooldowns.delete(key)}
 if(!health.acquire(provider))throw new ReasoningFailure('provider_circuit_open','provider',true,undefined,60000,provider,model);
 const timeoutMs=Math.max(1,Math.min(900000,request.timeoutMs??90000)),deadline=AbortSignal.timeout(timeoutMs),signal=request.signal?AbortSignal.any([request.signal,deadline]):deadline;
 try{
  const r=await fetch(url,{method:'POST',headers:{Authorization:`Bearer ${apiKey}`,'Content-Type':'application/json',...headers},body:JSON.stringify(body),signal});
  const data:any=await r.json().catch(()=>{if(!r.ok)throw responseFailure(provider,model,r.status,{},r.headers.get('retry-after'));throw new ReasoningFailure('invalid_response','model',true,r.status,0,provider,model)});
  const apiError=data?.error??data?.choices?.[0]?.error;
  if(!r.ok||apiError){
   const bodyError=apiError??data;
   const platformLimited=(r.status===429||Number(apiError?.code)===429)&&(r.headers.has('x-ratelimit-limit')||r.headers.has('x-ratelimit-remaining')||r.headers.has('x-ratelimit-reset'));
   const scopedError=platformLimited?{...bodyError,metadata:{...(bodyError?.metadata??{}),platform_rate_limit:true}}:bodyError;
   throw responseFailure(provider,model,Number(apiError?.code)||r.status,scopedError,r.headers.get('retry-after'));
  }
  const choice=data?.choices?.[0];
  if(choice?.message?.refusal||choice?.finish_reason==='content_filter')throw new ReasoningFailure('policy_denied','request',false,403,0,provider,model);
  if(typeof choice?.message?.content!=='string'||!choice.message.content.trim())throw new ReasoningFailure('empty_output','model',true,r.status,0,provider,model);
  signal.throwIfAborted();health.success(provider);return{r,data};
 }catch(error){
  if(request.signal?.aborted)throw request.signal.reason;
  const failure=deadline.aborted?new ReasoningFailure('timeout','model',true,408,0,provider,model):reasoningFailure(error);
  // A single model timeout does not establish a provider outage; repeated timeouts still feed the provider circuit.
  if(failure.kind==='timeout'||failure.scope==='provider'&&failure.kind==='provider_unavailable')health.failure(provider);
  if(failure.scope!=='request'&&(failure.retryAfterMs>0||['rate_limited','model_unavailable','credits_unavailable','timeout'].includes(failure.kind))){
   const key=failure.scope==='model'?`${provider}::${model}`:failure.scope==='paid_provider'?`${provider}:paid`:provider;
   // Never shorten Retry-After or reset a longer concurrent cooldown.
   const until=Math.max(cooldowns.get(key)?.until??0,Date.now()+(failure.retryAfterMs||60000));
   pruneCooldowns();
   if(!cooldowns.has(key)&&cooldowns.size>=MAX_COOLDOWNS){overflowUntil=Math.max(overflowUntil,until);throw new ReasoningFailure('transport_capacity_cooldown','request',false,undefined,until-Date.now(),provider,model)}
   cooldowns.set(key,{until,kind:failure.kind,scope:failure.scope});
  }
  throw failure;
 }finally{health.release(provider)}
}
export class OpenRouterProvider implements ReasoningProvider{
 constructor(private readonly apiKey=process.env.OPENROUTER_API_KEY,private readonly defaultModel=process.env.FS_REMOTE_REASONING_MODEL??'openai/gpt-5.1'){}
 async complete(req:ReasoningRequest){const model=req.model??this.defaultModel,{r,data}=await jsonRequest('openrouter','https://openrouter.ai/api/v1/chat/completions',this.apiKey,{model,...(req.costClass==='free'?{provider:{max_price:{prompt:0,completion:0,request:0,image:0}}}:{}),messages:[{role:'system',content:req.system},{role:'user',content:req.prompt}],temperature:req.temperature??0.1,max_tokens:req.maxTokens??4000},{'X-Title':'FS Engineering Remote v3'},req);return {provider:'openrouter',model:data.model??model,text:String(data.choices?.[0]?.message?.content??''),usage:data.usage,requestId:r.headers.get('x-request-id')??undefined}}
}
export class NvidiaProvider implements ReasoningProvider{
 constructor(private readonly apiKey=process.env.NVIDIA_API_KEY){}
 async complete(req:ReasoningRequest){if(!req.model)throw new Error('NVIDIA reviewer requires an explicit model id.');const {r,data}=await jsonRequest('nvidia','https://integrate.api.nvidia.com/v1/chat/completions',this.apiKey,{model:req.model,messages:[{role:'system',content:req.system},{role:'user',content:req.prompt}],temperature:req.temperature??0.1,max_tokens:req.maxTokens??4000},{},req);return {provider:'nvidia',model:data.model??req.model,text:String(data.choices?.[0]?.message?.content??''),usage:data.usage,requestId:r.headers.get('x-request-id')??undefined}}
}
export class OpenAIProvider implements ReasoningProvider{
 constructor(private readonly apiKey=process.env.OPENAI_API_KEY){}
 async complete(req:ReasoningRequest){if(!req.model)throw new Error('OpenAI reviewer requires an explicit model id.');const {r,data}=await jsonRequest('openai','https://api.openai.com/v1/chat/completions',this.apiKey,{model:req.model,messages:[{role:'system',content:req.system},{role:'user',content:req.prompt}],temperature:req.temperature??0.1,max_tokens:req.maxTokens??4000},{},req);return {provider:'openai',model:data.model??req.model,text:String(data.choices?.[0]?.message?.content??''),usage:data.usage,requestId:r.headers.get('x-request-id')??undefined}}
}
export class MultiProviderReasoning implements ReasoningProvider{
 private readonly providers={openrouter:new OpenRouterProvider(),nvidia:new NvidiaProvider(),openai:new OpenAIProvider()};
 async complete(req:ReasoningRequest){const encoded=req.model??'',m=encoded.match(/^(openrouter|nvidia|openai)::(.+)$/);if(!m)return this.providers.openrouter.complete(req);const provider=m[1] as keyof typeof this.providers,model=m[2];return this.providers[provider].complete({...req,model})}
}
export function reasoningProvider():ReasoningProvider{return new MultiProviderReasoning()}
export function providerHealth(){return health.snapshot()}
