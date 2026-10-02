import {ZodError} from 'zod';

const protocolErrors={
 NODE_INVALID_ID:{statusCode:400,error:"Invalid node id."},
 NODE_WORKSPACE_DENIED:{statusCode:403,error:"Cross-workspace node access denied."},
 NODE_REGISTRATION_CONFLICT:{statusCode:409,error:"Node id is already registered; use a new id or an explicitly authorized credential rotation."},
 NODE_RECOVERY_CONFLICT:{statusCode:409,error:"Node job is not awaiting explicit recovery."},
 NODE_TARGET_INVALID:{statusCode:400,error:"Execution nodes accept only the local execution target."},
 NODE_NOT_FOUND:{statusCode:404,error:"Execution node not found."},
 NODE_QUEUE_BLOCKED:{statusCode:409,error:"Execution node cannot accept queued work: readiness or compatibility blocks dispatch."},
 NODE_CAPABILITY_UNSUPPORTED:{statusCode:400,error:"Node does not advertise the requested capability."},
 NODE_PROJECT_DENIED:{statusCode:403,error:"Node is not authorized for this project."},
 NODE_PARENT_INVALID:{statusCode:400,error:"Mission/step not found in this workspace."},
 NODE_IDEMPOTENCY_INVALID:{statusCode:400,error:"Invalid idempotency key."},
 NODE_IDEMPOTENCY_CONFLICT:{statusCode:409,error:"Idempotency conflict: the key is already bound to a different node request."},
 NODE_MISSION_NOT_EXECUTABLE:{statusCode:409,error:"Mission/step is not executable before approval or after cancellation/completion."},
 NODE_IDEMPOTENCY_UNRESOLVED:{statusCode:503,error:"Idempotent dispatch could not resolve the concurrent insertion."},

 NODE_CREDENTIALS_INVALID:{statusCode:401,error:'Invalid node credentials.'},
 NODE_NOT_READY:{statusCode:409,error:'Node cannot claim work until readiness and compatibility checks pass.'},
 NODE_LEASE_INVALID:{statusCode:409,error:'Invalid or expired node job lease.'},
} as const;
export type NodeProtocolErrorCode=keyof typeof protocolErrors;
export class NodeProtocolError extends Error {
 constructor(readonly code:NodeProtocolErrorCode){super(protocolErrors[code]?.error??'Node service is temporarily unavailable.');}
}
/** Never classify arbitrary exception text as authentication or expose it on the wire. */
export function nodeProtocolFailure(error:unknown){
 if(error instanceof NodeProtocolError&&Object.hasOwn(protocolErrors,error.code)){const value=protocolErrors[error.code];return{...value,code:error.code};}
 if(error instanceof ZodError)return{statusCode:400,error:'Invalid node request.',code:'NODE_INVALID_REQUEST'};
 return{statusCode:503,error:'Node service is temporarily unavailable.',code:'NODE_SERVICE_UNAVAILABLE'};
}
