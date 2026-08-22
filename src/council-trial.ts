import fs from 'node:fs/promises';
export interface CouncilTrialModel{id:string;provider:'openrouter'|'nvidia'|'openai';costClass:'free'|'paid';roles:string[]}
export interface CouncilTrialConfig{name:string;paidConsent:{models:string[];scope:string;persistent:false};models:CouncilTrialModel[];policy:string}
export async function loadCouncilTrial(file='config/council-trial-2026-08-22.json'):Promise<CouncilTrialConfig>{const x=JSON.parse(await fs.readFile(file,'utf8'));if(x?.paidConsent?.persistent!==false)throw new Error('Council trial paid consent must be non-persistent.');return x}
export function trialAssignment(c:CouncilTrialConfig,role:string){return c.models.find(m=>m.roles.includes(role))??null}
export function trialAllowsPaid(c:CouncilTrialConfig,modelId:string){return c.paidConsent.models.includes(modelId)}