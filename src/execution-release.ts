export type OptionalExecutionTarget = 'sandbox' | 'hosted';

/** These adapters exist, but their production acceptance contracts are not complete.
 * An environment toggle or healthy endpoint is not an isolation/durability attestation.
 * Releasing one requires a reviewed implementation and end-to-end acceptance tests.
 */
export function optionalExecutionRelease(target: OptionalExecutionTarget) {
  return {
    target,
    enabled: false as const,
    state: 'policy-disabled' as const,
    reason: target === 'hosted'
      ? 'Hosted repository execution requires an accepted isolation boundary before repository scripts may run beside service credentials.'
      : 'Sandbox execution requires accepted workspace-scoped durable submission, completion, evidence and accounting before release.',
  };
}
export function assertOptionalExecutionReleased(target: OptionalExecutionTarget): void {
  throw new Error(`EXECUTION_RELEASE_DISABLED: ${optionalExecutionRelease(target).reason}`);
}
