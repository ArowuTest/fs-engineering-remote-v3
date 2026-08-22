import {ProviderHealthRegistry} from './provider-health.js';
export interface ReasoningRequest{system:string;prompt:string;model?:string;temperature?:number;maxTokens?:number}
export interface ReasoningResponse{provider:string;model:string;text:string;usage?:Record<string,unknown>;requestId?:string}
export interface ReasoningProvider{complete(req:ReasoningRequest):Promise<ReasoningResponse>}
const health=new ProviderHealthRegistry(3,60000);
async function jsonRequest(provider:string,url:string,apiKey:string|undefined,body:Record<string,unknown>,headers:Record<string,string>={}){if(!apiKey)throw new Error(`${provider} API key is not configured.`);if(!health.canUse(provider))throw new Error(`${provider} circuit is open after repeated failures.`);try{const r=await fetch(url,{method:'POST',headers:{Authorization:`Bearer ${apiKey}`,'Content-Type':'application/json',...headers},body:JSON.stringify(body)});const data:any=await r.json().catch(()=>({}));if(!r.ok)throw new Error(`${provider} ${r.status}: ${data?.error?.message??data?.message??'request failed'}`);health.success(provider);return {r,data}}catch(error){health.failure(provider);throw error}}
export class OpenRouterProvider implements ReasoningProvider{
 constructor(private readonly apiKey=process.env.OPENROUTER_API_KEY,private readonly defaultModel=process.env.FS_REMOTE_REASONING_MODEL??'openai/gpt-5.1'){}
 async complete(req:ReasoningRequest){const model=req.model??this.defaultModel,{r,data}=await jsonRequest('openrouter','https://openrouter.ai/api/v1/chat/completions',this.apiKey,{model,messages:[{role:'system',content:req.system},{role:'user',content:req.prompt}],temperature:req.temperature??0.1,max_tokens:req.maxTokens??4000},{'X-Title':'FS Engineering Remote v3'});return {provider:'openrouter',model:data.model??model,text:String(data.choices?.[0]?.message?.content??''),usage:data.usage,requestId:r.headers.get('x-request-id')??undefined}}
}
export class NvidiaProvider implements ReasoningProvider{
 constructor(private readonly apiKey=process.env.NVIDIA_API_KEY){}
 async complete(req:ReasoningRequest){if(!req.model)throw new Error('NVIDIA reviewer requires an explicit model id.');const {r,data}=await jsonRequest('nvidia','https://integrate.api.nvidia.com/v1/chat/completions',this.apiKey,{model:req.model,messages:[{role:'system',content:req.system},{role:'user',content:req.prompt}],temperature:req.temperature??0.1,max_tokens:req.maxTokens??4000});return {provider:'nvidia',model:data.model??req.model,text:String(data.choices?.[0]?.message?.content??''),usage:data.usage,requestId:r.headers.get('x-request-id')??undefined}}
}
export class OpenAIProvider implements ReasoningProvider{
 constructor(private readonly apiKey=process.env.OPENAI_API_KEY){}
 async complete(req:ReasoningRequest){if(!req.model)throw new Error('OpenAI reviewer requires an explicit model id.');const {r,data}=await jsonRequest('openai','https://api.openai.com/v1/chat/completions',this.apiKey,{model:req.model,messages:[{role:'system',content:req.system},{role:'user',content:req.prompt}],temperature:req.temperature??0.1,max_tokens:req.maxTokens??4000});return {provider:'openai',model:data.model??req.model,text:String(data.choices?.[0]?.message?.content??''),usage:data.usage,requestId:r.headers.get('x-request-id')??undefined}}
}
export class MultiProviderReasoning implements ReasoningProvider{
 private readonly providers={openrouter:new OpenRouterProvider(),nvidia:new NvidiaProvider(),openai:new OpenAIProvider()};
 async complete(req:ReasoningRequest){const encoded=req.model??'',m=encoded.match(/^(openrouter|nvidia|openai)::(.+)$/);if(!m)return this.providers.openrouter.complete(req);const provider=m[1] as keyof typeof this.providers,model=m[2];return this.providers[provider].complete({...req,model})}
}
export function reasoningProvider():ReasoningProvider{return new MultiProviderReasoning()}
export function providerHealth(){return health.snapshot()}
