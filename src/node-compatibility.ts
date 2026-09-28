import { SERVICE_VERSION } from './version.js';
export const NODE_PROTOCOL_VERSION=1;
export const NODE_MIN_PROTOCOL_VERSION=1;
export interface NodeAgentIdentity{schemaVersion:'fs.node.agent.v1';serviceVersion:string;protocolVersion:number;gitCommit?:string;platform:string;arch:string;node:string}
export interface NodeCompatibility{schemaVersion:'fs.node.compatibility.v1';status:'compatible'|'upgrade_required'|'unknown';executionAllowed:boolean;serverServiceVersion:string;serverProtocolVersion:number;minimumProtocolVersion:number;agentServiceVersion?:string;agentProtocolVersion?:number;reason:string}
export function evaluateNodeCompatibility(agent?:Partial<NodeAgentIdentity>|null):NodeCompatibility{
 const base={schemaVersion:'fs.node.compatibility.v1' as const,serverServiceVersion:SERVICE_VERSION,serverProtocolVersion:NODE_PROTOCOL_VERSION,minimumProtocolVersion:NODE_MIN_PROTOCOL_VERSION,agentServiceVersion:agent?.serviceVersion,agentProtocolVersion:agent?.protocolVersion};
 if(!agent||!Number.isInteger(agent.protocolVersion))return{...base,status:'unknown',executionAllowed:true,reason:'Node has not reported a protocol version yet; compatibility is unknown and legacy execution remains allowed.'};
 const protocol=Number(agent.protocolVersion);
 if(protocol<NODE_MIN_PROTOCOL_VERSION)return{...base,status:'upgrade_required',executionAllowed:false,reason:`Node protocol ${protocol} is older than minimum supported protocol ${NODE_MIN_PROTOCOL_VERSION}.`};
 if(protocol>NODE_PROTOCOL_VERSION)return{...base,status:'upgrade_required',executionAllowed:false,reason:`Node protocol ${protocol} is newer than server protocol ${NODE_PROTOCOL_VERSION}; upgrade the control plane before executing work.`};
 return{...base,status:'compatible',executionAllowed:true,reason:`Node protocol ${protocol} is compatible with server protocol ${NODE_PROTOCOL_VERSION}.`};
}
