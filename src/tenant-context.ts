export type WorkspaceRole='owner'|'admin'|'engineer'|'reviewer'|'viewer';
export interface TenantContext{workspaceId:string;userId?:string;role?:WorkspaceRole}
export function requireWorkspaceId(value:unknown):string{if(typeof value!=='string'||!/^[A-Za-z0-9._-]{1,160}$/.test(value))throw new Error('A valid workspaceId is required.');return value}
export function assertWorkspaceAccess(expected:string|undefined,actual:string|undefined){if(!expected) return;if(!actual||expected!==actual)throw new Error('Cross-workspace access denied.')}
export function canMutate(role:WorkspaceRole|undefined){return role==='owner'||role==='admin'||role==='engineer'}
export function requireMutationRole(role:WorkspaceRole|undefined){if(!canMutate(role))throw new Error('Workspace role does not permit mutation.')}
