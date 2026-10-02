export interface ActionPrincipal {mode: 'legacy' | 'oauth'; workspaceId?: string; role?: string; scopes?: string[]}
export class ActionAccessDenied extends Error { readonly statusCode = 403; }
const reads: Record<string, ReadonlySet<string>> = {
  fs: new Set(['roots', 'list', 'read', 'search', 'map', 'instructions']),
  process: new Set(['read', 'exec_list', 'exec_poll']),
  git: new Set(['status', 'diff', 'inspect', 'worktree_list', 'changed_since']),
  memory: new Set(['read', 'load_checkpoint', 'load_project_context', 'resume_project']),
  skills: new Set(['list', 'read', 'list_resources', 'read_resource', 'evaluate']),
  engineering: new Set(['health', 'capabilities', 'bootstrap', 'readiness', 'evidence', 'plan_work', 'database_capabilities', 'docker_status', 'docker_logs']),
  browser: new Set(['snapshot', 'console', 'network', 'screenshot', 'accessibility', 'performance']),
};
const mutations: Record<string, ReadonlySet<string>> = {
  fs: new Set(['write', 'edit', 'patch']),
  process: new Set(['run', 'start', 'stop', 'exec_write', 'exec_cancel']),
  git: new Set(['stage', 'commit', 'push', 'worktree_create', 'worktree_remove']),
  memory: new Set(['write', 'append_event', 'save_checkpoint', 'save_project_context', 'project_lifecycle']),
  engineering: new Set(['engineering_check', 'deployment', 'evidence_bundle']),
  browser: new Set(['start', 'navigate', 'click', 'type', 'wait', 'viewport', 'close']),
};
const missionReads = new Set(['list','get','summary','resolve','handoff_latest','handoff_list','resume_context','evidence_list']);
const missionWrites = new Set(['create','start','next','block','resume','cancel','set_alias','handoff_save','evidence_record']);

/** Authorization is enforced before parsing can dispatch any side effect.
 * A token's original scope never overrides the principal's current role.
 * Operator credentials remain a separate explicit trust boundary.
 */
export function authorizeAction(principal: ActionPrincipal | undefined, domain: string, body: Record<string, any>): void {
  if (principal?.mode === 'legacy') return;
  const denied = (reason: string): never => { throw new ActionAccessDenied(reason); };
  if (!principal?.workspaceId || !['owner','admin','engineer','reviewer','viewer'].includes(principal.role ?? '')) denied('An active workspace membership is required.');
  const requireScope = (scope: string) => { if (!principal?.scopes?.includes(scope)) denied(`OAuth scope '${scope}' is required.`); };
  const requireWrite = () => { requireScope('fs.write'); if (!['owner','admin','engineer'].includes(principal!.role!)) denied('Workspace role does not permit mutation.'); };
  const requireAdmin = () => { requireWrite(); requireScope('fs.admin'); if (!['owner','admin'].includes(principal!.role!)) denied('Workspace administrator authority is required.'); };
  const action = String(body.action ?? '');
  if (domain === 'engineering' && action === 'mission') {
    const sub = String(body.missionAction ?? '');
    if (missionReads.has(sub)) { requireScope('fs.read'); return; }
    if (sub === 'approve') { requireAdmin(); return; }
    // Passing a caller-supplied boolean is not deterministic acceptance evidence.
    if (sub === 'verify') denied('Mission acceptance is performed by the governed verifier, not a caller-supplied boolean.');
    if(sub==='evidence_record'&&(!['info','unknown'].includes(String(body.status))||body.kind!=='annotation'||!String(body.source??'').startsWith('user:')))denied('Caller notes cannot assert verification evidence or executor authority.');
    if (missionWrites.has(sub)) { requireWrite(); requireScope('fs.node'); return; }
    denied('Unsupported workspace mission action.');
  }
  if (domain === 'engineering' && action === 'worker') {
    const sub = String(body.workerAction ?? '');
    if (['list','get','status'].includes(sub)) { requireScope('fs.read'); return; }
    if (['retry','cancel'].includes(sub)) { requireAdmin(); requireScope('fs.node'); return; }
    denied('Worker lease and completion operations require an operator/executor credential.');
  }
  // Host-wide environment/database/provider operations must never borrow server credentials
  // on behalf of a workspace. A future tenant adapter can expose an explicitly bound resource.
  if (domain === 'engineering' && ['database','github','intelligence','environment','diagnose','capability_health'].includes(action)) denied('This host-wide operation requires an operator credential.');
  if (reads[domain]?.has(action)) { requireScope('fs.read'); return; }
  if (mutations[domain]?.has(action)) { requireWrite(); return; }
  denied('Unsupported or unauthorized workspace action.');
}
