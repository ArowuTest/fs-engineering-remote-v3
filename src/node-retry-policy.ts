import type {NodeCapability} from './nodes.js';
export type NodeRetryPolicy='automatic'|'manual';
export interface NodeRetryDecision{schemaVersion:'fs.node.retry-policy.v1';policy:NodeRetryPolicy;reason:string}
const SAFE:Partial<Record<NodeCapability,Set<string>>>={
 filesystem:new Set(['list','read','search','map','instructions']),
 git:new Set(['status','diff','inspect','worktree_list','changed_since']),
 process:new Set(['read','exec_list','exec_poll']),
 browser:new Set(['snapshot','console','network','accessibility','performance']),
 engineering:new Set(['docker_status','docker_logs']),
};
export function nodeRetryPolicy(capability:NodeCapability,operation:string,payload:Record<string,unknown>={}):NodeRetryDecision{
 if(SAFE[capability]?.has(operation))return{schemaVersion:'fs.node.retry-policy.v1',policy:'automatic',reason:`${capability}/${operation} is classified as replay-safe.`};
 return{schemaVersion:'fs.node.retry-policy.v1',policy:'manual',reason:`${capability}/${operation} may have side effects; lease loss requires explicit recovery before retry.`};
}
