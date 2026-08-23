import path from 'node:path';
import { runtimeIdentity } from './runtime.js';
import { WorkerQueue } from './workers.js';
import { MissionManager } from './missions.js';
import { PersistentExecutor } from './executor.js';
import { modelGateway } from './model-gateway.js';
import { ReviewCouncil } from './council.js';
import { migrateDatabase } from './db.js';
import { parseActionPlan, PlanDispatcher } from './plans.js';
import { changeRisk } from './risk.js';
import { recipeFromEvidence } from './verification-recipe.js';
import { MissionOrchestrator } from './orchestrator.js';
import { ContinuousEngineeringSupervisor } from './continuous-supervisor.js';
import { ReviewerCatalogStore } from './reviewer-catalog.js';
import { selectReviewerFleet, reviewerCatalogNeedsRefresh } from './reviewer-broker.js';
import { refreshReviewerCatalog } from './reviewer-source.js';
import { buildCouncilContext } from './council-context.js';
import { VerificationDispatcher } from './verification-dispatch.js';
import { HostedGitExecutor } from './hosted-git-executor.js';

await migrateDatabase();

const identity = runtimeIdentity();
const queue = new WorkerQueue(path.join(identity.stateRoot, 'work-queue'));
const missions = new MissionManager(path.join(identity.stateRoot, 'missions'));
const executor = new PersistentExecutor(
  identity,
  queue,
  missions,
  Number(process.env.FS_REMOTE_WORKER_POLL_MS ?? 2000),
  Number(process.env.FS_REMOTE_WORKER_LEASE_MS ?? 120000),
);
const orchestrator = new MissionOrchestrator(missions, queue);
const supervisor = new ContinuousEngineeringSupervisor(missions, orchestrator, Number(process.env.FS_REMOTE_SUPERVISOR_POLL_MS ?? 1500));
const reviewerCatalog = new ReviewerCatalogStore();

executor.register('hosted_git', async item => {
  const result = await new HostedGitExecutor().execute(item.payload as any);
  return { result: result as unknown as Record<string,unknown>, evidence: [{ kind: 'hosted_git', source: 'railway-worker', status: 'pass', summary: `Hosted Git branch  committed and pushed at .`, data: { repository: result.repository, branch: result.branch, commit: result.commit, changed: result.changed, verification: result.verification.map(v=>({command:v.command,ok:v.ok})) } }] };
});

executor.register('evidence', async item => ({
  result: { recorded: true },
  evidence: [{
    kind: String(item.payload.kind ?? 'worker'),
    source: String(item.payload.source ?? 'persistent-executor'),
    status: (['pass','fail','info','unknown'].includes(String(item.payload.status)) ? String(item.payload.status) : 'info') as 'pass'|'fail'|'info'|'unknown',
    summary: String(item.payload.summary ?? 'Evidence worker completed.'),
    data: { instanceId: identity.instanceId, workId: item.id },
  }],
}));

executor.register('reasoning', async item => {
  const mission = await missions.get(item.missionId);
  const out = await modelGateway().complete({
    system: String(item.payload.system ?? 'You are the autonomous reasoning worker for FS Engineering Remote v3. Produce a concrete next engineering decision grounded in the supplied mission and evidence.'),
    prompt: String(item.payload.prompt ?? JSON.stringify({ mission, evidence: await missions.evidence(mission.id) })),
    model: item.payload.model ? String(item.payload.model) : undefined,
    configuredModelId: item.payload.model ? String(item.payload.model) : ((mission.metadata as any).reasoningModel ? String((mission.metadata as any).reasoningModel) : undefined),
    paidModelConsent: Boolean((mission.metadata as any).paidModelConsent),
    criticality: String(item.payload.criticality ?? 'outcome_critical') as 'mechanical'|'supporting'|'outcome_critical',
    task: String(item.payload.task ?? 'autonomous engineering reasoning'),
  });
  try {
    const plan = parseActionPlan(out.text);
    const evidence = await missions.evidence(mission.id);
    const step = mission.steps.find(s => s.id === item.stepId);
    const promptContext = JSON.parse(String(item.payload.prompt ?? '{}')) as any;
    const expected = {
      missionId: mission.id,
      goal: mission.goal,
      step,
      metadata: mission.metadata,
      evidence: evidence.filter(e => e.stepId === item.stepId),
      quality: promptContext.quality,
    };
    const dispatch = await new PlanDispatcher().dispatch(mission.id, item.stepId, plan, expected);
    return {
      result: { provider: out.provider, model: out.model, text: out.text, requestId: out.requestId, plan, dispatch },
      evidence: [{ kind: 'reasoning', source: `${out.provider}:${out.model}`, status: 'info', summary: 'Autonomous reasoning completed.', data: { requestId: out.requestId } }],
    };
  } catch (error) {
    return {
      result: { provider: out.provider, model: out.model, text: out.text, requestId: out.requestId, planError: error instanceof Error ? error.message : String(error) },
      evidence: [{ kind: 'reasoning_plan', source: `${out.provider}:${out.model}`, status: 'fail', summary: 'Reasoning output failed governed action-plan validation.', data: { requestId: out.requestId, error: error instanceof Error ? error.message : String(error) } }],
    };
  }
});

executor.register('verification_repeat', async item => {
  const mission = await missions.get(item.missionId);
  const prior = (await missions.evidence(mission.id))
    .filter(e => e.stepId === item.stepId && e.status === 'pass' && /test|build|ci|deploy|security|database|browser/i.test([e.kind, e.summary].join(' ')))
    .sort((a,b) => b.observedAt.localeCompare(a.observedAt))[0];
  if (!prior) return { result: { verified: false }, evidence: [{ kind: 'reliability_verification', source: 'persistent-executor', status: 'unknown', summary: 'No deterministic verification evidence was available to repeat.', data: { gate: item.payload.gate, run: item.payload.run } }] };
  const recipe = recipeFromEvidence(prior);
  if (!recipe) return { result: { verified: false, priorEvidenceId: prior.id }, evidence: [{ kind: 'reliability_verification', source: 'persistent-executor', status: 'unknown', summary: 'Prior evidence did not contain an executable verification recipe; pass^k cannot be claimed.', data: { priorEvidenceId: prior.id, gate: item.payload.gate, run: item.payload.run } }] };
  const md:any=mission.metadata??{},nodeId=String(md.executionNodeId??''),project=String(md.executionProject??mission.cwd??'');
  if (!nodeId) return { result: { verified: false, recipe, requiresNodeExecution: true }, evidence: [{ kind: 'reliability_verification', source: 'persistent-executor', status: 'unknown', summary: 'Executable verification recipe is ready but no governed execution node is assigned to this mission.', data: { recipe, gate: item.payload.gate, run: item.payload.run } }] };
  const job=await new VerificationDispatcher().dispatch({missionId:mission.id,stepId:item.stepId,nodeId,project,recipe,run:Number(item.payload.run??1),gate:item.payload.gate});
  return { result: { verified: false, recipe, nodeJob: job, awaitingNodeExecution: true }, evidence: [{ kind: 'reliability_verification_dispatch', source: 'persistent-executor', status: 'unknown', summary: 'Independent verification recipe dispatched to governed execution node.', data: { recipe, gate: item.payload.gate, run: item.payload.run, nodeJob: job } }] };
});

executor.register('review_council', async item => {
  const mission = await missions.get(item.missionId);
  const evidence = await missions.evidence(mission.id);
  const risk = changeRisk(`${mission.goal} ${String(item.payload.candidate ?? '')}`);
  const roles = Array.isArray(item.payload.roles) ? item.payload.roles.map(String) : risk.roles;
  const configuredModels = Array.isArray(item.payload.models)
    ? item.payload.models.map(String)
    : Array.isArray((mission.metadata as any).reviewerModels)
      ? (mission.metadata as any).reviewerModels.map(String)
      : [];

  let models = configuredModels;
  let reviewerSelection: unknown = { autoSelected: false, reason: 'User-configured reviewer fleet.' };
  if (!models.length) {
    let catalog = await reviewerCatalog.list();
    if (reviewerCatalogNeedsRefresh(catalog)) {
      try {
        const refreshed = await refreshReviewerCatalog();
        await reviewerCatalog.upsert(refreshed.models);
        catalog = await reviewerCatalog.list();
      } catch (error) {
        return {
          result: { reviewConfigurationRequired: true, reason: `Reviewer catalog refresh failed: ${error instanceof Error ? error.message : String(error)}`, roles },
          evidence: [{ kind: 'reviewer_configuration', source: 'reviewer-broker', status: 'unknown', summary: 'Reviewer provider/benchmark catalog refresh failed; council cannot select benchmark-backed reviewers safely.', data: { roles, error: error instanceof Error ? error.message : String(error) } }],
        };
      }
    }
    const fleet = selectReviewerFleet(catalog, roles, []);
    reviewerSelection = fleet;
    models = fleet.assignments?.map(a => `${a.provider}::${a.modelId}`) ?? [];
    if (!models.length) {
      return {
        result: { reviewConfigurationRequired: true, reason: fleet.reason, reviewerSelection: fleet },
        evidence: [{ kind: 'reviewer_configuration', source: 'reviewer-broker', status: 'unknown', summary: fleet.reason, data: { roles, fleet } }],
      };
    }
  }

  const step = mission.steps.find(s => s.id === item.stepId) ?? mission.steps.find(s => s.id === mission.currentStepId) ?? mission.steps[0];
  if (!step) throw new Error('Review council requires a mission step.');
  const councilContext = buildCouncilContext(mission, step, String(item.payload.candidate ?? ''), evidence);
  const result = await new ReviewCouncil().run({
    missionId: mission.id,
    goal: mission.goal,
    candidate: String(item.payload.candidate ?? ''),
    evidence,
    context: councilContext,
    roles,
    models,
    paidModelConsent: Boolean((mission.metadata as any).paidModelConsent),
  });
  const verdict = String(result.adjudication?.verdict ?? 'changes');
  return {
    result: { ...result, reviewerSelection } as unknown as Record<string,unknown>,
    evidence: [{
      kind: 'review_council',
      source: 'reviewer-broker:council',
      status: verdict === 'approve' ? 'pass' : verdict === 'block' ? 'fail' : 'info',
      summary: `Review council adjudication: ${verdict}.`,
      data: { councilId: result.id, adjudication: result.adjudication, reviewerSelection },
    }],
  };
});

await executor.start();
console.log(`[fs-remote-worker] instance=${identity.instanceId} worker=${executor.capabilities().workerId} state=${identity.stateRoot} kinds=${executor.capabilities().kinds.join(',')}`);

const activeMissions = new Map<string,Promise<unknown>>();
async function ensureReviewerReadiness(mission:any) {
  if (Array.isArray(mission.metadata?.reviewerModels) && mission.metadata.reviewerModels.length) return;
  const existing=(await missions.evidence(mission.id)).find(e=>e.kind==='reviewer_configuration'&&e.source==='reviewer-broker:project-start');
  if(existing)return;
  const roles=changeRisk(mission.goal).roles;
  let catalog=await reviewerCatalog.list();
  if(reviewerCatalogNeedsRefresh(catalog)){
    try{const refreshed=await refreshReviewerCatalog();await reviewerCatalog.upsert(refreshed.models);catalog=await reviewerCatalog.list()}catch(error){await missions.addEvidence({missionId:mission.id,kind:'reviewer_configuration',source:'reviewer-broker:project-start',status:'unknown',summary:'No reviewer fleet was configured and automatic benchmark catalog refresh failed.',data:{roles,error:error instanceof Error?error.message:String(error)}});return}
  }
  const fleet=selectReviewerFleet(catalog,roles,[]);
  await missions.addEvidence({missionId:mission.id,kind:'reviewer_configuration',source:'reviewer-broker:project-start',status:fleet.models.length?'info':'unknown',summary:fleet.models.length?(fleet.notification??fleet.reason):fleet.reason,data:{roles,fleet}});
}
async function scanMissions() {
  for (const mission of await missions.list()) {
    if (!['planned','running','verifying'].includes(mission.status) || activeMissions.has(mission.id)) continue;
    await ensureReviewerReadiness(mission);
    const run = supervisor.runMission(mission.id, { maxCycles: Number(process.env.FS_REMOTE_SUPERVISOR_MAX_CYCLES ?? 10000) })
      .catch(async error => {
        await missions.addEvidence({ missionId: mission.id, stepId: mission.currentStepId, kind: 'supervisor', source: 'continuous-factory', status: 'fail', summary: `Continuous supervisor stopped unexpectedly: ${error instanceof Error ? error.message : String(error)}` });
      })
      .finally(() => activeMissions.delete(mission.id));
    activeMissions.set(mission.id, run);
  }
}
const scanner = setInterval(() => void scanMissions(), Number(process.env.FS_REMOTE_SUPERVISOR_SCAN_MS ?? 3000));
void scanMissions();

const stop = async () => {
  clearInterval(scanner);
  supervisor.stop();
  await Promise.allSettled(activeMissions.values());
  await executor.stop();
  process.exit(0);
};
process.on('SIGINT', () => void stop());
process.on('SIGTERM', () => void stop());
await new Promise(() => {});

