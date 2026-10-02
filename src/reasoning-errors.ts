export type FailureScope='request'|'model'|'provider'|'paid_provider';
export class ReasoningFailure extends Error{
 constructor(readonly kind:string,readonly scope:FailureScope,readonly fallbackAllowed:boolean,readonly status?:number,readonly retryAfterMs=0,readonly provider?:string,readonly model?:string){super(`${provider??'reasoning'} ${status??''}: ${kind}`);this.name='ReasoningFailure'}
}
export function retryAfterMs(value:string|null,now=Date.now()){
 if(value===null||value.trim()==='')return 0;
 const numeric=Number(value);
 let milliseconds:number;
 if(!Number.isNaN(numeric))milliseconds=numeric*1000;
 else{const at=Date.parse(value);if(!Number.isFinite(at))throw new ReasoningFailure('invalid_retry_duration','request',false);milliseconds=Math.max(0,at-now)}
 if(!Number.isFinite(milliseconds)||milliseconds<0||!Number.isSafeInteger(Math.ceil(milliseconds))||milliseconds>Number.MAX_SAFE_INTEGER-now)throw new ReasoningFailure('invalid_retry_duration','request',false);
 return milliseconds;
}
// An upstream shared model pool is distinct from the gateway account quota.
// Explicit platform/account/unknown scope always wins; never branch on remedy_hint.
function modelRateLimit(message:string,metadata:Record<string,unknown>,requestedModel?:string){
 if(metadata.platform_rate_limit===true)return false;
 if(metadata.is_byok!==undefined&&metadata.is_byok!==false)return false;
 const scopes=[metadata.scope,metadata.limit_scope].filter(x=>x!==undefined);
 if(scopes.some(x=>x!=='model'))return false;
 if(/account.{0,40}(rate.?limit|quota)|daily.{0,40}(limit|quota)|requests per (minute|day)/i.test(message))return false;
 const source=metadata.limit_source;
 if(source!==undefined&&source!=='upstream_provider_shared_pool')return false;
 if(scopes.includes('model'))return true;
 if(typeof metadata.provider_name!=='string'||!metadata.provider_name.trim())return false;
 if(source==='upstream_provider_shared_pool')return true;
 const raw=typeof metadata.raw==='string'?metadata.raw.slice(0,16384):'';
 // Legacy provider envelopes have no structured limit_source. Match the exact
 // requested model, not arbitrary availability wording or a different model.
 if(requestedModel&&raw.startsWith(requestedModel+' is temporarily rate-limited upstream.'))return true;
 return false; // Unstructured scope is provider-wide; exact legacy identity/structured metadata above is required.
}
export function classifyFailure(status:number|undefined,message:string,type='',metadata:Record<string,unknown>={},requestedModel?:string){
 const deny=/content[_ -]?policy|moderation|guardrail|prompt.?injection|safety block|safety refusal/i;
 if(deny.test(type)||/^(?:refusal|refused)$/i.test(type)||deny.test(message)||metadata.flagged_input!==undefined||metadata.patterns!==undefined)return{kind:'policy_denied',scope:'request' as const,fallbackAllowed:false};
 if(status===401||/authentication|permission_denied|permission_error|invalid_api_key|authorization_denied/i.test(type)||status===404&&/\b(account|subscription|tier|permission)\b/i.test(message))return{kind:'authorization_denied',scope:'request' as const,fallbackAllowed:false};
 const modelAccess=/model.{0,80}(restricted to|only available to|not available (to|for)|not found|does not exist)|restricted to agentic harnesses|no endpoints found/i.test(message);
 if(status===403&&/^This model is restricted to agentic harnesses\.?$/i.test(message.trim()))return{kind:'model_unavailable',scope:'model' as const,fallbackAllowed:true};
 if(status===403)return{kind:'authorization_denied',scope:'request' as const,fallbackAllowed:false};
 if(status===402||/payment_required|insufficient.?credit|credits exhausted/i.test(type+' '+message))return{kind:'credits_unavailable',scope:'paid_provider' as const,fallbackAllowed:true};
 if(status===429||type==='rate_limit_exceeded'){
  const explicitModel=modelRateLimit(message,metadata,requestedModel);
  return{kind:'rate_limited',scope:explicitModel?'model' as const:'provider' as const,fallbackAllowed:true};
 }
 if(status===404&&modelAccess)return{kind:'model_unavailable',scope:'model' as const,fallbackAllowed:true};
 if(status!==undefined&&status>=400&&status<500&&status!==408&&status!==425)return{kind:'invalid_request_or_unknown',scope:'request' as const,fallbackAllowed:false};
 if(status===408||status===425||status!==undefined&&status>=500||type==='provider_unavailable'||status===undefined&&/timeout|timed out|fetch failed|connection|temporar|provider (?:is )?down|circuit is open|unavailable/i.test(message))return{kind:'provider_unavailable',scope:'provider' as const,fallbackAllowed:true};
 return{kind:'invalid_request_or_unknown',scope:'request' as const,fallbackAllowed:false};
}
export function responseFailure(provider:string,model:string,status:number,body:any,retryAfter:string|null){
 const message=String(body?.message??'request failed'),metadata=body?.metadata??{},type=String(metadata.error_type??body?.type??body?.code??'');
 const c=classifyFailure(status,message,type,metadata,model);
 // Only classification is retained: raw provider metadata may contain private prompt excerpts.
 const nestedHeaders=metadata.headers&&typeof metadata.headers==='object'?metadata.headers:{};
 const nestedRetries=Object.entries(nestedHeaders).filter(([key])=>key.toLowerCase()==='retry-after').map(([,value])=>{if(typeof value!=='string'&&typeof value!=='number')throw new ReasoningFailure('invalid_retry_duration','request',false);return retryAfterMs(String(value))});
 const seconds=metadata.retry_after_seconds;
 if(seconds!==undefined&&(typeof seconds!=='number'||!Number.isFinite(seconds)||seconds<0))throw new ReasoningFailure('invalid_retry_duration','request',false);
 const nestedMs=seconds===undefined?0:retryAfterMs(String(seconds));
 const wait=Math.max(retryAfterMs(retryAfter),...nestedRetries,nestedMs);
 if(!Number.isFinite(wait)||wait>Number.MAX_SAFE_INTEGER-Date.now())throw new ReasoningFailure('invalid_retry_duration','request',false);
 return new ReasoningFailure(c.kind,c.scope,c.fallbackAllowed,status,wait,provider,model);
}
export function reasoningFailure(error:unknown):ReasoningFailure{
 if(error instanceof ReasoningFailure)return error;
 const e=error as any,message=error instanceof Error?error.message:String(error);
 if(e?.name==='AbortError'||/caller cancelled|caller canceled/i.test(message))return new ReasoningFailure('cancelled','request',false);
 // Transport implementations create ReasoningFailure directly. A message prefix is never authority.
 const status=typeof e?.status==='number'&&Number.isInteger(e.status)?e.status:undefined;
 if(status===undefined){
  if(error instanceof TypeError&&/fetch failed|network|connection/i.test(message))return new ReasoningFailure('provider_unavailable','provider',true);
  return new ReasoningFailure('invalid_request_or_unknown','request',false);
 }
 const wait=e?.retryAfterMs===undefined?0:Number(e.retryAfterMs);
 if(!Number.isFinite(wait)||wait<0||wait>Number.MAX_SAFE_INTEGER-Date.now())return new ReasoningFailure('invalid_retry_duration','request',false);
 const metadata=e?.metadata&&typeof e.metadata==='object'&&!Array.isArray(e.metadata)?e.metadata:{};
 const classified=responseFailure('reasoning',typeof e?.model==='string'?e.model:'',status,{message,type:String(e?.type??''),metadata},String(wait/1000));
 return new ReasoningFailure(classified.kind,classified.scope,classified.fallbackAllowed,status,classified.retryAfterMs);
}
