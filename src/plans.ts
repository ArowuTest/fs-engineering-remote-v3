import crypto from 'node:crypto';
import { z } from 'zod';
import { NodeRegistry, type NodeCapability } from './nodes.js';

const actionSchema = z.object({
  id: z.string().regex(/^[A-Za-z0-9._-]{1,80}$/),
  nodeId: z.string().regex(/^[A-Za-z0-9._-]+$/),
  project: z.string().min(1).max(160),
  capability: z.enum(['filesystem','command','process','git','browser','docker','database']),
  operation: z.string().min(1).max(80),
  payload: z.record(z.string(), z.unknown()).default({}),
  verify: z.object({kind:z.string().min(1),description:z.string().min(1)}).strict().optional()
}).strict();
const planSchema = z.object({
  decision: z.enum(['execute','await_approval','blocked']),
  summary: z.string().min(1).max(4000),
  actions: z.array(actionSchema).max(20),
  verification: z.array(z.object({kind:z.string().min(1),description:z.string().min(1)}).strict()).max(20).default([])
}).strict().superRefine((v,c)=>{
  if(v.decision==='execute'&&!v.actions.length)c.addIssue({code:'custom',message:'execute requires at least one action'});
  if(v.decision!=='execute'&&v.actions.length)c.addIssue({code:'custom',message:'non-execute decisions cannot contain actions'});
});
export type ActionPlan=z.infer<typeof planSchema>;
const allowed:Record<NodeCapability,Set<string>>={filesystem:new Set(['list','read','write','edit']),command:new Set(['run']),process:new Set(['start','read','stop']),git:new Set(['status','diff','stage','commit','push']),browser:new Set(['start','navigate','snapshot','click','type','wait','console','network','screenshot','viewport','accessibility','performance','close']),docker:new Set(['run']),database:new Set(['run'])};
export function parseActionPlan(text:string):ActionPlan{let raw:unknown;try{raw=JSON.parse(text)}catch{const m=text.match(/\{[\s\S]*\}/);if(!m)throw new Error('Reasoning output did not contain a JSON action plan.');raw=JSON.parse(m[0])}return planSchema.parse(raw)}
export class PlanDispatcher{constructor(private readonly nodes=new NodeRegistry()){}async dispatch(missionId:string,stepId:string,input:ActionPlan){const p=planSchema.parse(input);if(p.decision!=='execute')return {decision:p.decision,jobs:[]};const jobs=[];for(const a of p.actions){if(!allowed[a.capability].has(a.operation))throw new Error(`Operation ${a.capability}/${a.operation} is not in the governed action vocabulary.`);const key=crypto.createHash('sha256').update(JSON.stringify({missionId,stepId,a})).digest('hex');jobs.push(await this.nodes.enqueue({missionId,stepId,nodeId:a.nodeId,project:a.project,capability:a.capability,operation:a.operation,payload:{...a.payload,__planActionId:a.id,__idempotencyKey:key}},{idempotencyKey:key}))}return {decision:p.decision,jobs}}}
