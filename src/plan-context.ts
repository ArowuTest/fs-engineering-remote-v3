import {qualityContract} from './quality.js';
import type {Mission, MissionStep, Evidence} from './missions.js';

/** The planner and dispatcher must fingerprint the same authoritative input fields.
 * Derived risk/proof/retrieval views are provided to the model separately, never
 * compared against a different fingerprint shape at the execution boundary.
 */
export function canonicalPlanContext(input: {missionId: string; goal: string; step: unknown; metadata: unknown; evidence: unknown; quality: unknown}) {
  return {missionId: input.missionId, goal: input.goal, step: input.step, metadata: input.metadata, evidence: input.evidence, quality: input.quality};
}
export function currentPlanContext(mission: Mission, step: MissionStep, evidence: Evidence[]) {
  return canonicalPlanContext({missionId: mission.id, goal: mission.goal, step, metadata: mission.metadata, evidence: evidence.filter(e => e.stepId === step.id), quality: qualityContract(mission.goal, step.acceptance)});
}
