export type ExecutionEvidenceStatus = 'pass' | 'fail' | 'info' | 'unknown';

/** Interpret the operation result, not merely successful transport or a resolved promise. */
export function executionEvidenceStatus(capability: string, operation: string, input: unknown): ExecutionEvidenceStatus {
  let value: any = input;
  if (value && typeof value === 'object' && Object.hasOwn(value, 'value')) value = value.value;
  if (value && typeof value === 'object' && value.schemaVersion === 'fs-remote.execution-result.v1') value = value.result;
  if (value && typeof value === 'object') {
    if (value.timedOut === true || value.ok === false || value.accepted === false || value.error || ['failed', 'timed_out', 'killed', 'interrupted', 'cancelled', 'health_failed'].includes(value.status)) return 'fail';
    if (Object.hasOwn(value, 'exitCode') && value.exitCode !== null && value.exitCode !== 0) return 'fail';
  }
  if (capability === 'command' || capability === 'docker') return value?.exitCode === 0 && value?.timedOut !== true ? 'pass' : 'fail';
  if (capability === 'engineering' && operation === 'check') {
    if (value?.status === 'running') return 'info';
    return value?.status === 'passed' && value?.exitCode === 0 ? 'pass' : 'fail';
  }
  if (capability === 'engineering' && operation === 'evidence_bundle') return 'info';
  if (capability === 'process') {
    if (['start', 'exec_write', 'exec_cancel', 'stop'].includes(operation)) return 'info';
    if (value?.status === 'running') return 'info';
    if (Object.hasOwn(value ?? {}, 'exitCode')) return value.exitCode === 0 ? 'pass' : 'unknown';
  }
  return value === undefined || value === null ? 'unknown' : 'pass';
}

/** PersistentExecutor wraps handler output; retain reads of older, already stored records. */
export function workHandlerResult(input: any): any {
  return input?.schemaVersion === 'fs-remote.execution-result.v1' ? input.result : input;
}
