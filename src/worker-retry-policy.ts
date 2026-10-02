/** Work kinds whose handlers do not execute customer side effects.
 * Caller payload flags never grant replay authority. Unknown/custom work is manual.
 */
export const REPLAY_SAFE_WORK_KINDS = ['evidence', 'review_council', 'verification_repeat'] as const;
export function workerReplaySafe(kind: string): boolean {
  return (REPLAY_SAFE_WORK_KINDS as readonly string[]).includes(kind);
}
