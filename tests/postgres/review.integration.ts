import test, {before, after} from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import Fastify from 'fastify';
import {db, migrateDatabase} from '../../src/db.js';
import {migrateMultiUserSchema} from '../../src/multi-user-schema.js';
import {MissionManager} from '../../src/missions.js';
import {WorkerQueue} from '../../src/workers.js';
import {NodeRegistry} from '../../src/nodes.js';
import {ExecutionRouter} from '../../src/execution-router.js';
import {AccountingStore} from '../../src/accounting-store.js';
import {SupervisorLeaseStore} from '../../src/supervisor-lease.js';
import {HandoffStore} from '../../src/handoff.js';
import {registerAuthRoutes} from '../../src/auth-http.js';
import {registerNodeRoutes} from '../../src/node-http.js';
import {validateConfig} from '../../src/config.js';
import {hashOpaqueToken} from '../../src/auth-crypto.js';
import {RetentionLifecycle} from '../../src/retention-lifecycle.js';

// Fail closed. This suite must never discover or reuse an application DATABASE_URL.
const raw = process.env.FS_REVIEW_PG_URL;
if (!raw) throw new Error('FS_REVIEW_PG_URL must explicitly name an isolated local review database.');
const url = new URL(raw);
if (!['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) || !/^\/fs_v3_review(?:_[a-z0-9]+)?$/.test(url.pathname) || url.username !== 'fs_review') throw new Error('Refusing a non-review or non-local PostgreSQL target.');
const schema = `review_${crypto.randomBytes(8).toString('hex')}`;
url.searchParams.set('options', `-c search_path=${schema}`);
process.env.DATABASE_URL = url.toString();
process.env.FS_REMOTE_INSTANCE_ID = schema;
const dirs: string[] = [];
const id = (p: string) => `${p}-${crypto.randomUUID()}`;
before(async () => {
  await db().query(`CREATE SCHEMA ${schema}`);
  await migrateDatabase(); await migrateMultiUserSchema();
});
after(async () => {
  try { await db().query(`DROP SCHEMA ${schema} CASCADE`); }
  finally { await db().end(); for (const dir of dirs) await fs.rm(dir, {recursive: true, force: true}); }
});
async function fixture() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'fs-pg-review-')); dirs.push(dir);
  const user = id('user'), a = id('workspace-a'), b = id('workspace-b');
  await db().query('INSERT INTO users(id,username,password_hash) VALUES($1,$2,$3)', [user, user, 'fixture-not-a-login-hash']);
  for (const workspace of [a, b]) {
    await db().query('INSERT INTO workspaces(id,slug,name,owner_user_id) VALUES($1,$1,$1,$2)', [workspace, user]);
    await db().query("INSERT INTO workspace_memberships(workspace_id,user_id,role) VALUES($1,$2,'owner')", [workspace, user]);
  }
  const manager = new MissionManager(path.join(dir, 'missions'), a);
  const mission = await manager.create({goal: 'Inspect fixture', root: 'fixture', cwd: '.', steps: [{title: 'Inspect', acceptance: ['Read fixture']}], metadata: {productContractResolved: true}});
  return {dir, user, a, b, manager, mission, queue: new WorkerQueue(path.join(dir, 'queue'), 120000, a)};
}
async function nodeFixture() {
  const f = await fixture(), nodes = new NodeRegistry(f.a), nodeId = id('node');
  const registration = await nodes.register({nodeId, name: 'fixture node', platform: process.platform, capabilities: ['filesystem', 'command', 'engineering'], projects: ['fixture']});
  const job = await nodes.enqueue({missionId: f.mission.id, stepId: 'step-1', nodeId, project: 'fixture', capability: 'command', operation: 'run', payload: {root: 'fixture', command: 'fixture-only'}});
  const claimed = await nodes.claim(nodeId, registration.nodeSecret);
  return {...f, nodes, nodeId, secret: registration.nodeSecret, job, claimed: claimed!};
}

test('R01 PostgreSQL: recorded evidence is visible from a fresh manager with no local files', async () => {
  const f = await fixture();
  const record = await f.manager.addEvidence({missionId: f.mission.id, stepId: 'step-1', kind: 'test', source: 'fixture', status: 'pass', summary: 'fixture only'});
  const fresh = new MissionManager(path.join(f.dir, 'different-process-root'), f.a);
  assert.deepEqual((await fresh.evidence(f.mission.id)).map(x => x.id), [record.id]);
  assert.equal((await new MissionManager(path.join(f.dir, 'b'), f.b).evidence(f.mission.id)).length, 0);
});

test('R02 PostgreSQL: service-wide mission and worker updates preserve tenant ownership', async () => {
  const f = await fixture();
  await new MissionManager(path.join(f.dir, 'service-missions')).start(f.mission.id);
  assert.equal((await db().query('SELECT workspace_id FROM missions WHERE id=$1', [f.mission.id])).rows[0].workspace_id, f.a);
  const item = await f.queue.enqueue({missionId: f.mission.id, stepId: 'step-1', kind: 'evidence'});
  const serviceQueue = new WorkerQueue(path.join(f.dir, 'service-queue'));
  const claimed = await serviceQueue.claim(id('worker'), ['evidence']);
  assert.equal(claimed?.id, item.id);
  await serviceQueue.complete(item.id, claimed!.lease!.workerId, claimed!.lease!.token, {fixture: true});
  assert.equal((await db().query('SELECT workspace_id FROM work_items WHERE id=$1', [item.id])).rows[0].workspace_id, f.a);
  assert.equal((await f.queue.get(item.id)).status, 'completed');
});

test('R03 PostgreSQL: workspace A cannot dispatch to workspace B node', async () => {
  const f = await fixture(), nodeId = id('node-b');
  await new NodeRegistry(f.b).register({nodeId, name: 'B node', platform: 'linux', capabilities: ['filesystem'], projects: ['fixture']});
  await assert.rejects(() => new ExecutionRouter().dispatch({missionId: f.mission.id, stepId: 'step-1', nodeId, project: 'fixture', capability: 'filesystem', operation: 'read', payload: {root: 'fixture', path: 'marker.txt'}, executionTarget: 'local', workspaceId: f.a}), /workspace|not found/i);
  assert.equal((await db().query('SELECT count(*)::int n FROM node_jobs WHERE node_id=$1', [nodeId])).rows[0].n, 0);
});

test('S01 PostgreSQL: a colliding node ID cannot transfer ownership or replace credentials', async () => {
  const f = await fixture(), nodeId = id('collision');
  const b = new NodeRegistry(f.b), original = await b.register({nodeId, name: 'B node', platform: 'linux', capabilities: ['filesystem'], projects: []});
  await assert.rejects(() => new NodeRegistry(f.a).register({nodeId, name: 'A collision', platform: 'linux', capabilities: ['filesystem'], projects: []}), /exists|collision|registered/i);
  assert.equal((await NodeRegistry.resolveIdentity(nodeId, original.nodeSecret))?.workspaceId, f.b);
});

test('S02 PostgreSQL: expired node and supervisor leases cannot be resurrected before recovery', async () => {
  const f = await nodeFixture();
  await db().query("UPDATE node_jobs SET lease_expires_at=now()-interval '1 second' WHERE id=$1", [f.job.id]);
  await assert.rejects(() => f.nodes.renew(f.nodeId, f.secret, f.job.id, f.claimed.leaseToken), /expired|lease/i);
  const leases = new SupervisorLeaseStore(), owner = id('supervisor');
  assert.equal(await leases.acquire(f.mission.id, owner), true);
  await db().query("UPDATE mission_supervisor_leases SET lease_expires_at=now()-interval '1 second' WHERE mission_id=$1", [f.mission.id]);
  assert.equal(await leases.renew(f.mission.id, owner), false);
});

test('S04 PostgreSQL: completion cannot overwrite a concurrent new lease after the old ownership read', async () => {
  const f = await fixture(), item = await f.queue.enqueue({missionId: f.mission.id, stepId: 'step-1', kind: 'evidence'});
  const claim = await f.queue.claim('old-worker', ['evidence']);
  const pool: any = db(), original = pool.query.bind(pool), other = await pool.connect();
  let intervened = false;
  pool.query = async (sql: string, values: any[]) => {
    const relevant = /(?:SELECT \* FROM work_items|UPDATE work_items SET)/.test(sql);
    if (!intervened && relevant) {
      intervened = true;
      const snapshot = /^SELECT/.test(sql) ? await original(sql, values) : undefined;
      await other.query("UPDATE work_items SET lease_owner='new-worker',lease_expires_at=now()+interval '2 minutes',payload=payload||$2::jsonb WHERE id=$1", [item.id, JSON.stringify({__leaseToken: 'new-lease-token'})]);
      if (snapshot) return snapshot;
    }
    return original(sql, values);
  };
  try { await assert.rejects(() => f.queue.complete(item.id, 'old-worker', claim!.lease!.token), /lease|owned|expired/i); }
  finally { pool.query = original; other.release(); }
  assert.equal(intervened, true, 'the actual SQL boundary must have been exercised');
  const row = (await db().query('SELECT status,lease_owner FROM work_items WHERE id=$1', [item.id])).rows[0];
  assert.equal(row.status, 'leased'); assert.equal(row.lease_owner, 'new-worker');
});

test('S05 PostgreSQL: failure writing evidence rolls back node completion', async () => {
  const f = await nodeFixture();
  await db().query("CREATE OR REPLACE FUNCTION reject_fixture_evidence() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'fixture evidence failure'; END $$");
  await db().query('CREATE TRIGGER reject_fixture_evidence BEFORE INSERT ON evidence FOR EACH ROW EXECUTE FUNCTION reject_fixture_evidence()');
  try {
    await assert.rejects(() => f.nodes.complete(f.nodeId, f.secret, f.job.id, f.claimed.leaseToken, {value: {exitCode: 0, timedOut: false}}, 'completed'), /fixture evidence failure/);
    assert.equal((await db().query('SELECT status FROM node_jobs WHERE id=$1', [f.job.id])).rows[0].status, 'leased');
  } finally { await db().query('DROP TRIGGER reject_fixture_evidence ON evidence'); }
});

test('S06 PostgreSQL: handoff list/latest obey the workspace boundary', async () => {
  const f = await fixture();
  const a = new (HandoffStore as any)(path.join(f.dir, 'handoffs'), f.a), b = new (HandoffStore as any)(path.join(f.dir, 'other-handoffs'), f.b);
  await a.save({missionId: f.mission.id, goal: 'fixture', completed: [], decisions: ['A private fixture'], blockers: [], pendingQuestions: [], nextActions: [], metadata: {}});
  assert.equal(await b.latest(f.mission.id), null);
  assert.deepEqual(await b.list(f.mission.id), []);
});

test('R08 PostgreSQL: lease recovery of hosted side effects requires explicit recovery', async () => {
  const f = await fixture(), item = await f.queue.enqueue({missionId: f.mission.id, stepId: 'step-1', kind: 'hosted_git'});
  await f.queue.claim('fixture-worker', ['hosted_git']);
  await db().query("UPDATE work_items SET lease_expires_at=now()-interval '1 second' WHERE id=$1", [item.id]);
  await f.queue.recover();
  assert.equal((await f.queue.get(item.id)).status, 'recovery_required');
});

test('S09 PostgreSQL: workspace admins cannot invite owners or reset an owner password', async () => {
  const f = await fixture(), admin = id('admin'), token = crypto.randomBytes(32).toString('hex');
  await db().query('INSERT INTO users(id,username,password_hash) VALUES($1,$1,$2)', [admin, 'fixture-hash']);
  await db().query("INSERT INTO workspace_memberships(workspace_id,user_id,role) VALUES($1,$2,'admin')", [f.a, admin]);
  await db().query("INSERT INTO user_sessions(id,token_hash,user_id,workspace_id,expires_at) VALUES($1,$2,$3,$4,now()+interval '1 hour')", [id('session'), hashOpaqueToken(token), admin, f.a]);
  const app = Fastify(); registerAuthRoutes(app);
  try {
    const headers = {authorization: `Bearer ${token}`};
    assert.equal((await app.inject({method: 'POST', url: '/api/admin/invitations', headers, payload: {role: 'owner'}})).statusCode, 403);
    assert.equal((await app.inject({method: 'POST', url: `/api/admin/users/${f.user}/password-reset`, headers, payload: {}})).statusCode, 403);
  } finally { await app.close(); }
});

test('S10: node authentication attempts are actually rate limited', async () => {
  const app = Fastify(); registerNodeRoutes(app, validateConfig({endpointSecret: 'e'.repeat(48), actionsSecret: 'a'.repeat(48), roots: []}));
  try {
    let status = 0;
    for (let i = 0; i < 250 && status !== 429; i++) status = (await app.inject({method: 'POST', url: '/node/heartbeat', payload: {}})).statusCode;
    assert.equal(status, 429);
  } finally { await app.close(); }
});

// Full default-target journey: real PostgreSQL, HTTP, a child node process and commands.
// Only the model/council opinion is a deterministic fixture; execution evidence is real.
test('R04/R05/R07/S07/S13: fresh OAuth enrollment, real node execution and durable accepted resumption', {timeout: 100000}, async () => {
  const {buildHttpApp} = await import('../../src/http.js');
  const {AuthStore} = await import('../../src/auth-store.js');
  const {hashPassword} = await import('../../src/auth-crypto.js');
  const {PersistentExecutor} = await import('../../src/executor.js');
  const {MissionOrchestrator} = await import('../../src/orchestrator.js');
  const {runtimeIdentity} = await import('../../src/runtime.js');
  const {spawn} = await import('node:child_process');
  const {fileURLToPath} = await import('node:url');
  const f = await fixture(), password = 'Fixture-only-password-123456';
  const repo = fileURLToPath(new URL('../../', import.meta.url));
  const prior: Record<string, string | undefined> = {};
  for (const name of ['FS_GPT_OAUTH_CLIENT_ID','FS_GPT_OAUTH_CLIENT_SECRET','FS_GPT_OAUTH_REDIRECT_URIS','FS_REMOTE_PUBLIC_BASE_URL']) prior[name] = process.env[name];
  process.env.FS_GPT_OAUTH_CLIENT_ID = 'fixture-harness';
  process.env.FS_GPT_OAUTH_CLIENT_SECRET = 'fixture-client-secret';
  process.env.FS_GPT_OAUTH_REDIRECT_URIS = 'https://harness.example/callback';
  await db().query('UPDATE users SET password_hash=$2 WHERE id=$1', [f.user, await hashPassword(password)]);
  const app = buildHttpApp(validateConfig({endpointSecret:'e'.repeat(48),actionsSecret:'a'.repeat(48),roots:[]}));
  const address = await app.listen({host: '127.0.0.1', port: 0});
  process.env.FS_REMOTE_PUBLIC_BASE_URL = address;
  let child: ReturnType<typeof spawn> | undefined, executor: InstanceType<typeof PersistentExecutor> | undefined;
  let log = '';
  async function until<T>(read:()=>Promise<T>, ready:(value:T)=>boolean, limit=40000):Promise<T>{const end=Date.now()+limit;for(;;){const value=await read();if(ready(value))return value;if(Date.now()>end)throw new Error('Journey timed out: '+log.slice(-2500));await new Promise(r=>setTimeout(r,100))}}
  try {
    const auth = new AuthStore(), invitation = await auth.invite({workspaceId:f.a,createdBy:f.user,role:'engineer'}), username=id('engineer');
    assert.equal((await app.inject({method:'POST',url:'/api/auth/signup',payload:{token:invitation.token,username,password}})).statusCode,201);
    const login = await app.inject({method:'POST',url:'/api/auth/login',payload:{username,password}});
    assert.equal(login.statusCode,200); const session=login.json().token;
    const authorized = await app.inject({method:'POST',url:'/oauth/authorize',headers:{origin:address,host:new URL(address).host},payload:{client_id:'fixture-harness',redirect_uri:'https://harness.example/callback',state:'fixture-state',scope:'fs.read fs.write fs.node',username,password}});
    assert.equal(authorized.statusCode,302);
    const redirect=new URL(authorized.headers.location!);assert.equal(redirect.searchParams.get('state'),'fixture-state');
    const tokenResponse=await app.inject({method:'POST',url:'/oauth/token',payload:{grant_type:'authorization_code',client_id:'fixture-harness',client_secret:'fixture-client-secret',redirect_uri:'https://harness.example/callback',code:redirect.searchParams.get('code')}});
    assert.equal(tokenResponse.statusCode,200);
    const me=await app.inject({method:'POST',url:'/actions/engineering',headers:{authorization:`Bearer ${tokenResponse.json().access_token}`},payload:{action:'mission',missionAction:'list'}});
    assert.equal(me.statusCode,200);assert.match(me.body,new RegExp(f.mission.id));
    const enrollment=await app.inject({method:'POST',url:'/api/account/nodes/enroll',headers:{authorization:`Bearer ${session}`},payload:{name:'Fixture node',platform:process.platform,projects:['fixture'],capabilities:['filesystem','command','engineering']}});
    assert.equal(enrollment.statusCode,201);
    const root=path.join(f.dir,'node-root');await fs.mkdir(root);await fs.writeFile(path.join(root,'marker.txt'),'FS_REAL_NODE_FIXTURE');
    const configFile=path.join(f.dir,'node-config.json');await fs.writeFile(configFile,JSON.stringify({endpointSecret:'e'.repeat(48),actionsSecret:'a'.repeat(48),roots:[{name:'fixture',path:root}],commandTimeoutMs:15000}));
    const nodeId=id('fixture-node');
    child=spawn(process.execPath,['--import','tsx','src/node-main.ts'],{cwd:repo,windowsHide:true,stdio:['ignore','pipe','pipe'],env:{...process.env,DATABASE_URL:'',FS_REMOTE_NODE_SECRET:'',FS_REMOTE_NODE_ENROLLMENT_TOKEN:enrollment.json().token,FS_REMOTE_NODE_ID:nodeId,FS_REMOTE_NODE_STATE_DIR:path.join(f.dir,'node-credentials'),FS_REMOTE_MCP_CONFIG:configFile,FS_REMOTE_CONTROL_PLANE_URL:address,FS_REMOTE_STATE_ROOT:path.join(f.dir,'node-runtime'),FS_REMOTE_INSTANCE_ID:'fixture-node-runtime',FS_REMOTE_NODE_LEASE_MS:'120000',GITHUB_TOKEN:'',OPENROUTER_API_KEY:'',OPENAI_API_KEY:'',ANTHROPIC_API_KEY:''}});
    child.stdout!.on('data',b=>{log=(log+String(b)).slice(-12000)});child.stderr!.on('data',b=>{log=(log+String(b)).slice(-12000)});
    await until(()=>new NodeRegistry(f.a).list(),nodes=>nodes.some(n=>n.id===nodeId&&n.lifecycle.state==='ready')).catch(async error=>{const state=await db().query(`SELECT status,metadata->'readiness' AS readiness,metadata->'compatibility' AS compatibility,metadata->'agent' AS agent FROM execution_nodes WHERE id=$1`,[nodeId]);throw new Error(String(error)+' nodeState='+JSON.stringify(state.rows))});
    const credential=await fs.readFile(path.join(f.dir,'node-credentials','node-credential'),'utf8');assert.ok(credential.length>=32);assert.equal(log.includes(credential),false);
    const mission=await f.manager.create({goal:'Read repository',root:'fixture',cwd:'.',steps:[{title:'Inspect repository',acceptance:['Read repository']}],metadata:{productContractResolved:true}});
    await f.manager.start(mission.id);await f.manager.next(mission.id);
    const router=new ExecutionRouter(),request={missionId:mission.id,stepId:'step-1',nodeId,project:'fixture',executionTarget:'local' as const,workspaceId:f.a};
    const first:any=await router.dispatch({...request,capability:'filesystem',operation:'read',payload:{root:'fixture',path:'marker.txt',__retrieval:{phase:'test repository'}}});
    const second:any=await router.dispatch({...request,capability:'command',operation:'run',payload:{root:'fixture',cwd:'.',command:'node -e "process.stdout.write(\'FS_JOURNEY_OK\')"'}});
    const nodes=new NodeRegistry(f.a);
    const firstDone=await until(()=>nodes.getJob(first.job.id),j=>{if(j?.status==='failed')throw new Error('Fixture read failed: '+JSON.stringify(j.result));return j?.status==='completed'}).catch(async error=>{const states=await db().query(`SELECT j.status AS job_status,m.status AS mission_status,s.status AS step_status,s.requires_approval,j.workspace_id AS job_ws,m.workspace_id AS mission_ws FROM node_jobs j LEFT JOIN missions m ON m.id=j.mission_id LEFT JOIN mission_steps s ON s.mission_id=m.id AND s.id=m.id||':'||j.step_id WHERE j.id=$1`,[first.job.id]);throw new Error(String(error)+' state='+JSON.stringify(states.rows))});
    const secondDone=await until(()=>nodes.getJob(second.job.id),j=>j?.status==='completed',15000);
    assert.match(JSON.stringify(firstDone.result),/FS_REAL_NODE_FIXTURE/);assert.match(JSON.stringify(secondDone.result),/FS_JOURNEY_OK/);
    assert.ok(Date.parse(secondDone.completed_at)-Date.parse(firstDone.completed_at)<10000,'completed jobs must not wait for the default 40-second renewal sleep');
    const failMission=await f.manager.create({goal:'Failure fixture',root:'fixture',cwd:'.',steps:[{title:'Run failing command'}]});
    const failed:any=await router.dispatch({...request,missionId:failMission.id,capability:'command',operation:'run',payload:{root:'fixture',cwd:'.',command:'node -e "process.exit(7)"',__verification:{run:1}}});
    await until(()=>nodes.getJob(failed.job.id),j=>j?.status==='failed',15000);
    const failureEvidence=await f.manager.evidence(failMission.id);assert.equal(failureEvidence.length,1);assert.equal(failureEvidence[0].status,'fail');
    // Represent a completed planner request, then use the actual executor's council envelope.
    const planner=await f.queue.enqueue({missionId:mission.id,stepId:'step-1',kind:'evidence'});const claimed=await f.queue.claim('fixture-planner',['evidence']);
    await f.queue.complete(planner.id,'fixture-planner',claimed!.lease!.token,{planned:true});
    const orchestrator=new MissionOrchestrator(f.manager,f.queue);
    const next=await orchestrator.reconcile(mission.id);assert.equal(next.state,'reviewing');
    executor=new PersistentExecutor(runtimeIdentity(),f.queue,f.manager,10,10000);
    executor.register('review_council',async()=>({result:{id:'fixture-council',adjudication:{verdict:'approve'},findings:[]},evidence:[{kind:'review_council',source:'council:fixture',status:'info',summary:'Deterministic test opinion, not a production review.'}]}));
    await executor.start();await until(()=>f.queue.get(next.work.id),w=>w.status==='completed',10000);await executor.stop();
    const accepted=await orchestrator.reconcile(mission.id);assert.equal(accepted.state,'completed');
    const resumed=new MissionManager(path.join(f.dir,'fresh-resume'),f.a);
    assert.equal((await resumed.get(mission.id)).status,'completed');assert.ok((await resumed.evidence(mission.id)).length>=3);
    assert.equal((await new MissionManager(path.join(f.dir,'fresh-b'),f.b).list()).some(m=>m.id===mission.id),false);
  } finally {
    if(executor)await executor.stop();
    if(child&&child.exitCode===null){child.kill('SIGTERM');await Promise.race([new Promise<void>(resolve=>child!.once('exit',()=>resolve())),new Promise<void>(resolve=>setTimeout(resolve,5000))]);}
    await app.close();for(const[name,value]of Object.entries(prior)){if(value===undefined)delete process.env[name];else process.env[name]=value;}
  }
});

test('worker evidence is fenced atomically with completion after ownership changes', async () => {
  const {PersistentExecutor}=await import('../../src/executor.js');
  const {runtimeIdentity}=await import('../../src/runtime.js');
  const f=await fixture(),item=await f.queue.enqueue({missionId:f.mission.id,stepId:'step-1',kind:'evidence'});
  const claim=await f.queue.claim('old-worker',['evidence']);
  const executor=new PersistentExecutor(runtimeIdentity(),f.queue,f.manager);
  (executor as any).workerId='old-worker';
  executor.register('evidence',async()=>{
    await db().query("UPDATE work_items SET lease_owner='new-worker',payload=payload||$2::jsonb WHERE id=$1",[item.id,JSON.stringify({__leaseToken:'new-token'})]);
    return{result:{fixture:true},evidence:[{kind:'test',source:'stale-worker-fixture',status:'pass',summary:'must not be persisted'}]};
  });
  await (executor as any).execute(claim);
  const evidence=await f.manager.evidence(f.mission.id);
  assert.equal(evidence.some(e=>e.source==='stale-worker-fixture'),false);
});

test('node dispatch validates mission and step ownership, not just node ownership', async () => {
  const f=await fixture(),nodeId=id('node-a');
  const node=new NodeRegistry(f.a);
  await node.register({nodeId,name:'A node',platform:'linux',capabilities:['filesystem'],projects:['fixture']});
  const foreign=await new MissionManager(path.join(f.dir,'missions-b'),f.b).create({goal:'B private',root:'fixture',cwd:'.',steps:[{title:'B step'}]});
  await assert.rejects(()=>node.enqueue({nodeId,missionId:foreign.id,stepId:'step-1',project:'fixture',capability:'filesystem',operation:'read',payload:{root:'fixture',path:'marker.txt'}}),/workspace|mission|step/i);
  await assert.rejects(()=>node.enqueue({nodeId,missionId:f.mission.id,stepId:'not-a-step',project:'fixture',capability:'filesystem',operation:'read',payload:{root:'fixture',path:'marker.txt'}}),/mission|step/i);
});

test('global worker enqueue inherits the authoritative mission workspace', async () => {
  const f=await fixture(), globalQueue=new WorkerQueue(path.join(f.dir,'global-queue'));
  const work=await globalQueue.enqueue({missionId:f.mission.id,stepId:'step-1',kind:'reasoning'});
  assert.equal(work.workspaceId,f.a,'new coordinator work must not enter the legacy null workspace');
  assert.equal((await f.queue.get(work.id)).workspaceId,f.a);
  await assert.rejects(()=>new WorkerQueue(path.join(f.dir,'foreign'),120000,f.b).get(work.id),/workspace|found/i);
  const row=(await db().query('SELECT workspace_id FROM work_items WHERE id=$1',[work.id])).rows[0];
  assert.equal(row.workspace_id,f.a);
});

test('worker enqueue rejects foreign missions, nonexistent missions and nonexistent steps', async () => {
  const f=await fixture(), foreign=new WorkerQueue(path.join(f.dir,'foreign'),120000,f.b);
  const input={missionId:f.mission.id,stepId:'step-1',kind:'reasoning'};
  await assert.rejects(()=>foreign.enqueue(input),/mission|workspace/i);
  await assert.rejects(()=>f.queue.enqueue({...input,missionId:'missing-'+crypto.randomUUID()}),/mission|workspace/i);
  await assert.rejects(()=>f.queue.enqueue({...input,stepId:'not-a-step'}),/mission|step/i);
  const count=(await db().query('SELECT count(*)::int AS n FROM work_items WHERE mission_id=$1',[f.mission.id])).rows[0].n;
  assert.equal(count,0);
});

test('production-style unscoped orchestrator creates tenant-owned planning work', async () => {
  const {MissionOrchestrator}=await import('../../src/orchestrator.js');
  const f=await fixture();await f.manager.start(f.mission.id);
  const coordinator=new MissionOrchestrator(new MissionManager(path.join(f.dir,'global-missions')),new WorkerQueue(path.join(f.dir,'global-queue')));
  const out=await coordinator.advance(f.mission.id);
  assert.equal(out.state,'planning');assert.equal(out.work.workspaceId,f.a);
  assert.equal((await f.queue.get(out.work.id)).workspaceId,f.a);
});

test('S14: production learning captures are workspace scoped and durably referenced', async () => {
  const {MissionOrchestrator}=await import('../../src/orchestrator.js');
  const f=await fixture(),learningRoot=path.join(f.dir,'experience');
  const orchestrator=new MissionOrchestrator(f.manager,f.queue,learningRoot);
  const failure=await f.manager.addEvidence({missionId:f.mission.id,stepId:'step-1',kind:'test',source:'test-fixture',status:'fail',summary:'fixture test failure'});
  await (orchestrator as any).learnNegative(f.mission,f.mission.steps[0],[failure],[],'deterministic_failure','fixture failure');
  const records=await new MissionManager(path.join(f.dir,'fresh-reader'),f.a).evidence(f.mission.id);
  const learned=records.find(e=>e.kind==='decision_experience');
  assert.ok(learned,'a local cache alone is not durable organizational knowledge');
  assert.equal(learned.workspaceId,f.a);assert.equal(learned.status,'info');
  await assert.rejects(()=>fs.access(path.join(learningRoot,'negative-experience.jsonl')));
});


test('PERSISTENCE-PARENT-01 evidence inherits parent workspace and refuses missing/foreign mission or step',async()=>{
 const f=await fixture(),global=new MissionManager(path.join(f.dir,'global-evidence'));
 const e=await global.addEvidence({missionId:f.mission.id,stepId:'step-1',kind:'test',source:'parent-fixture',status:'info',summary:'fixture'});
 assert.equal(e.workspaceId,f.a);
 for(const input of [{missionId:'missing',stepId:'step-1'},{missionId:f.mission.id,stepId:'missing'}])await assert.rejects(()=>global.addEvidence({...input,kind:'test',source:'parent-invalid',status:'pass',summary:'must not persist'}),/mission|step|workspace/i);
 await assert.rejects(()=>new MissionManager(path.join(f.dir,'foreign'),f.b).addEvidence({missionId:f.mission.id,stepId:'step-1',kind:'test',source:'foreign-invalid',status:'pass',summary:'must not persist'}),/mission|step|workspace/i);
 assert.equal((await db().query("SELECT count(*)::int AS n FROM evidence WHERE source IN ('parent-invalid','foreign-invalid')")).rows[0].n,0);
});
test('PERSISTENCE-PARENT-02 direct evidence store cannot bypass parent validation',async()=>{
 const {PgStateStore}=await import('../../src/pg-state.js');const f=await fixture(),store=new PgStateStore(f.b);
 await assert.rejects(()=>store.addEvidence({schemaVersion:'fs-remote.evidence.v1',id:id('bad-evidence'),missionId:f.mission.id,stepId:'step-1',kind:'test',source:'direct-foreign',status:'pass',summary:'must not persist',observedAt:new Date().toISOString()}),/mission|step|workspace/i);
});
test('PERSISTENCE-PARENT-03 handoff uses mission workspace and rejects missing or foreign parents',async()=>{
 const f=await fixture(),global=new HandoffStore(path.join(f.dir,'handoffs'));
 const input={missionId:f.mission.id,goal:'handoff fixture',completed:[],decisions:[],blockers:[],pendingQuestions:[],nextActions:[],metadata:{}};
 const h=await global.save(input);assert.equal(h.workspaceId,f.a);
 assert.equal((await new HandoffStore(path.join(f.dir,'fresh-handoff'),f.a).latest(f.mission.id))?.workspaceId,f.a);
 await assert.rejects(()=>global.save({...input,missionId:'missing'}),/mission|workspace/i);
 await assert.rejects(()=>new HandoffStore(path.join(f.dir,'foreign-handoff'),f.b).save(input),/mission|workspace/i);
});
test('PERSISTENCE-LEASE-01 heartbeat validates duration and preserves original database lease-grant time',async()=>{
 const f=await fixture();await f.queue.enqueue({missionId:f.mission.id,stepId:'step-1',kind:'evidence'});
 const work=(await f.queue.claim('duration-worker',['evidence'],60000))!;assert.ok(work.lease);const leasedAt=work.lease!.leasedAt;
 for(const duration of [0,-1,NaN,Infinity,900001])await assert.rejects(()=>f.queue.heartbeat(work.id,'duration-worker',work.lease!.token,duration),/lease|duration/i);
 await new Promise(r=>setTimeout(r,20));const renewed=await f.queue.heartbeat(work.id,'duration-worker',work.lease!.token,60000);
 assert.equal(renewed.lease!.leasedAt,leasedAt);assert.ok(renewed.lease!.heartbeatAt>=leasedAt);
});
test('PERSISTENCE-LEASE-02 direct store and scoped supervisor validate duration and mission ownership',async()=>{
 const {PgStateStore}=await import('../../src/pg-state.js');const f=await fixture(),store=new PgStateStore(f.a);
 await assert.rejects(()=>store.claim('worker',['evidence'],0),/duration|lease/i);
 const scoped=new (SupervisorLeaseStore as any)(f.b);
 assert.equal(await scoped.acquire(f.mission.id,'foreign-supervisor',30000),false);
 const own=new (SupervisorLeaseStore as any)(f.a);
 assert.equal(await own.acquire('missing','owner',30000),false);
 for(const duration of [0,-1,NaN,Infinity,900001])await assert.rejects(()=>own.acquire(f.mission.id,'owner',duration),/duration|lease/i);
 assert.equal(await own.acquire(f.mission.id,'owner',30000),true);
 await assert.rejects(()=>own.renew(f.mission.id,'owner',0),/duration|lease/i);
 await own.release(f.mission.id,'owner');
});
test('PERSISTENCE-LEASE-03 ordinary workspace work readers never receive owner lease credentials',async()=>{
 const {RemoteOperations}=await import('../../src/operations.js');const {ProcessManager}=await import('../../src/processes.js');
 const f=await fixture();await f.queue.enqueue({missionId:f.mission.id,stepId:'step-1',kind:'evidence'});const w=(await f.queue.claim('private-worker',['evidence']))!;
 const config=validateConfig({endpointSecret:'e'.repeat(48),actionsSecret:'a'.repeat(48),roots:[{name:'fixture',path:f.dir}]});
 const ops=new RemoteOperations(config,new ProcessManager({shell:'powershell.exe',maxOutputBytes:10000}),undefined,undefined,f.a);
 for(const action of ['get','list']){const result=await ops.workerOperation(action,{workId:w.id});assert.ok(!JSON.stringify(result).includes(w.lease!.token));assert.ok(!JSON.stringify(result).includes('__leaseToken'))}
});
test('CATALOG-PG-01 duplicate bare model names across providers survive a real PostgreSQL round trip',async()=>{
 const {ReviewerCatalogStore}=await import('../../src/reviewer-catalog.js');const name=id('catalog-model'),now=new Date().toISOString();
 const records:any[]=['openrouter','nvidia'].map(provider=>({id:name,provider,free:true,healthy:true,coding:0,reasoning:0,security:0,context:10000,observedAt:now,source:'fixture',benchmarks:[{benchmark:'fixture',dimension:'coding',score:.8,source:'fixture',observedAt:now}]}));
 const store=new ReviewerCatalogStore();await store.upsert(records);const loaded=(await store.list()).filter(x=>x.id===name);
 assert.equal(loaded.length,2);assert.deepEqual(new Set(loaded.map(x=>x.provider)),new Set(['openrouter','nvidia']));assert.equal(loaded[0].benchmarks?.[0].score,.8);
});


test('NODE-PARENT-01 unscoped trusted dispatch inherits node and mission workspace',async()=>{
 const f=await nodeFixture(),global=new NodeRegistry();
 await db().query("UPDATE execution_nodes SET capabilities='[\"filesystem\",\"command\"]'::jsonb WHERE id=$1",[f.nodeId]);
 const result=await global.enqueue({missionId:f.mission.id,stepId:'step-1',nodeId:f.nodeId,project:'fixture',capability:'filesystem',operation:'read',payload:{root:'fixture',path:'marker'}});
 assert.equal((await db().query('SELECT workspace_id FROM node_jobs WHERE id=$1',[result.id])).rows[0].workspace_id,f.a);
});
test('NODE-IDEM-01 idempotent dispatch binds content and handles concurrent duplicates',async()=>{
 const f=await nodeFixture(),registry=new NodeRegistry(f.a),key=id('dispatch');
 const input={missionId:f.mission.id,stepId:'step-1',nodeId:f.nodeId,project:'fixture',capability:'command' as const,operation:'run',payload:{root:'fixture',command:'fixture only'}};
 const both=await Promise.all([registry.enqueue(input,{idempotencyKey:key}),registry.enqueue(input,{idempotencyKey:key})]);assert.equal(both[0].id,both[1].id);
 await assert.rejects(()=>registry.enqueue({...input,payload:{root:'fixture',command:'different'}},{idempotencyKey:key}),/idempoten|conflict|request/i);
 await assert.rejects(()=>registry.enqueue({...input,stepId:'missing'},{idempotencyKey:key}),/mission|step|idempoten/i);
});
test('NODE-IDEM-02 identical raw request keys are isolated by workspace',async()=>{
 const a=await nodeFixture(),b=await nodeFixture(),key=id('shared-key');
 const input=(f:any)=>({missionId:f.mission.id,stepId:'step-1',nodeId:f.nodeId,project:'fixture',capability:'command' as const,operation:'run',payload:{root:'fixture',command:'fixture'}});
 const j1=await new NodeRegistry(a.a).enqueue(input(a),{idempotencyKey:key});
 const j2=await new NodeRegistry(b.a).enqueue(input(b),{idempotencyKey:key});assert.notEqual(j1.id,j2.id);
});
test('NODE-LEASE-01 claim rejects unbounded durations before issuing work',async()=>{
 const f=await nodeFixture();for(const duration of [0,-1,NaN,Infinity,900001])await assert.rejects(()=>f.nodes.claim(f.nodeId,f.secret,duration),/lease|duration/i);
});
test('NODE-PARENT-02 cancelled or approval-blocked missions cannot execute previously queued work',async()=>{
 for(const status of ['cancelled','awaiting_approval','blocked']){
  const f=await nodeFixture();await db().query("UPDATE node_jobs SET status='queued',lease_token_hash=NULL,lease_expires_at=NULL WHERE id=$1",[f.job.id]);await db().query('UPDATE missions SET status=$2 WHERE id=$1',[f.mission.id,status]);
  assert.equal(await f.nodes.claim(f.nodeId,f.secret),null,`${status} must prevent claim`);
 }
});
test('NODE-TARGET-01 a local execution node cannot accept a job labelled as hosted or sandbox',async()=>{
 const f=await nodeFixture();for(const executionTarget of ['hosted','sandbox'] as const)await assert.rejects(()=>f.nodes.enqueue({missionId:f.mission.id,stepId:'step-1',nodeId:f.nodeId,project:'fixture',capability:'command',operation:'run',payload:{root:'fixture',command:'fixture'},executionTarget}),/local|target/i);
});

test('NODE-CREDENTIAL-01 pending rotation keeps old credential until first successful new-secret use',async()=>{
 const f=await fixture(),nodes=new NodeRegistry(f.a),nodeId=id('rotation-node'),registered=await nodes.register({nodeId,name:'rotation',platform:'linux',capabilities:['filesystem'],projects:[]});
 const rotation=await nodes.beginCredentialRotation(nodeId,{userId:f.user,role:'owner'},600000);
 assert.ok(rotation.nodeSecret.length>=32);assert.notEqual(rotation.nodeSecret,registered.nodeSecret);
 assert.equal((await NodeRegistry.resolveIdentity(nodeId,registered.nodeSecret))?.workspaceId,f.a,'old credential remains valid until the pending credential is proven');
 assert.equal((await NodeRegistry.resolveIdentity(nodeId,rotation.nodeSecret))?.workspaceId,f.a,'new credential promotes on first authenticated use');
 assert.equal(await NodeRegistry.resolveIdentity(nodeId,registered.nodeSecret),null,'promotion invalidates the old credential');
 const row=(await db().query('SELECT credential_generation,pending_credential_hash,pending_credential_expires_at,credential_revoked_at FROM execution_nodes WHERE id=$1',[nodeId])).rows[0];
 assert.equal(row.credential_generation,2);assert.equal(row.pending_credential_hash,null);assert.equal(row.pending_credential_expires_at,null);assert.equal(row.credential_revoked_at,null);
});

test('NODE-CREDENTIAL-02 revocation immediately denies old credentials while preserving the node record',async()=>{
 const f=await fixture(),nodes=new NodeRegistry(f.a),nodeId=id('revoked-node'),registered=await nodes.register({nodeId,name:'revoked',platform:'linux',capabilities:['filesystem'],projects:[]});
 const revoked=await nodes.revokeCredential(nodeId,{userId:f.user,role:'owner'},'fixture compromise');
 assert.equal(revoked.revoked,true);assert.equal(await NodeRegistry.resolveIdentity(nodeId,registered.nodeSecret),null);
 const row=(await db().query('SELECT id,status,credential_revoked_at FROM execution_nodes WHERE id=$1',[nodeId])).rows[0];assert.equal(row.id,nodeId);assert.equal(row.status,'offline');assert.ok(row.credential_revoked_at);
 const recovery=await nodes.beginCredentialRotation(nodeId,{userId:f.user,role:'owner'},600000);
 assert.equal(await NodeRegistry.resolveIdentity(nodeId,registered.nodeSecret),null,'revoked primary never regains authority while recovery credential is pending');
 assert.ok(await NodeRegistry.resolveIdentity(nodeId,recovery.nodeSecret),'authorized recovery credential reactivates on proof of possession');
});

test('NODE-CREDENTIAL-03 credential maintenance is workspace- and role-bound',async()=>{
 const f=await fixture(),nodeId=id('owned-node'),nodes=new NodeRegistry(f.a),registered=await nodes.register({nodeId,name:'owned',platform:'linux',capabilities:['filesystem'],projects:[],metadata:{ownerUserId:f.user}});
 await assert.rejects(()=>new NodeRegistry(f.b).beginCredentialRotation(nodeId,{userId:f.user,role:'owner'}),/not authorized|not found|workspace|denied/i);
 await assert.rejects(()=>nodes.beginCredentialRotation(nodeId,{userId:id('other'),role:'engineer'}),/authorized|owner|denied/i);
 await assert.rejects(()=>nodes.revokeCredential(nodeId,{userId:id('viewer'),role:'viewer'},'nope'),/authorized|owner|denied/i);
 const own=await nodes.beginCredentialRotation(nodeId,{userId:f.user,role:'engineer'});assert.ok(own.nodeSecret);
 assert.ok(await NodeRegistry.resolveIdentity(nodeId,registered.nodeSecret),'rotation request alone does not invalidate current credential');
});

test('NODE-CREDENTIAL-04 node listings disclose lifecycle status but never credential hashes',async()=>{
 const f=await fixture(),nodes=new NodeRegistry(f.a),nodeId=id('list-node');await nodes.register({nodeId,name:'listed',platform:'linux',capabilities:['filesystem'],projects:[]});
 const serialized=JSON.stringify(await nodes.list());assert.match(serialized,/credentialStatus/);assert.doesNotMatch(serialized,/credential_hash|pending_credential_hash|nodeSecret/i);
});

test('NODE-CREDENTIAL-05 authenticated account routes rotate and revoke only workspace nodes',{timeout:30000},async()=>{
 const {buildHttpApp}=await import('../../src/http.js'),{hashPassword,hashOpaqueToken}=await import('../../src/auth-crypto.js');
 const f=await fixture(),password='Node-credential-route-password-123',nodes=new NodeRegistry(f.a),nodeId=id('route-node');
 await db().query('UPDATE users SET password_hash=$2 WHERE id=$1',[f.user,await hashPassword(password)]);
 await nodes.register({nodeId,name:'route node',platform:'linux',capabilities:['filesystem'],projects:[],metadata:{ownerUserId:f.user}});
 const app=buildHttpApp(validateConfig({endpointSecret:'e'.repeat(48),actionsSecret:'a'.repeat(48),roots:[]}));
 try{
  const login=await app.inject({method:'POST',url:'/api/auth/login',payload:{username:f.user,password}});assert.equal(login.statusCode,200);const session=login.json().token;
  const rotated=await app.inject({method:'POST',url:`/api/account/nodes/${encodeURIComponent(nodeId)}/credentials/rotate`,headers:{authorization:`Bearer ${session}`},payload:{ttlMs:300000}});
  assert.equal(rotated.statusCode,200);assert.ok(rotated.json().nodeSecret);assert.doesNotMatch(rotated.body,/credential_hash|pending_credential_hash/i);
  const revoked=await app.inject({method:'POST',url:`/api/account/nodes/${encodeURIComponent(nodeId)}/credentials/revoke`,headers:{authorization:`Bearer ${session}`},payload:{reason:'fixture rotation test'}});
  assert.equal(revoked.statusCode,200);assert.equal(revoked.json().revoked,true);
  const foreignId=id('foreign-route-node');await new NodeRegistry(f.b).register({nodeId:foreignId,name:'foreign',platform:'linux',capabilities:['filesystem'],projects:[],metadata:{ownerUserId:f.user}});
  const denied=await app.inject({method:'POST',url:`/api/account/nodes/${encodeURIComponent(foreignId)}/credentials/rotate`,headers:{authorization:`Bearer ${session}`},payload:{}});
  assert.equal(denied.statusCode,403);
 }finally{await app.close()}
});

test('NODE-CREDENTIAL-06 audit failure rolls back credential mutation',{timeout:100000},async()=>{
 const {buildHttpApp}=await import('../../src/http.js'),{hashPassword}=await import('../../src/auth-crypto.js'),{AuditStore}=await import('../../src/audit-store.js');
 const f=await fixture(),password='Node-audit-rollback-password-123',nodes=new NodeRegistry(f.a),nodeId=id('audit-node');
 await db().query('UPDATE users SET password_hash=$2 WHERE id=$1',[f.user,await hashPassword(password)]);
 const registered=await nodes.register({nodeId,name:'audit node',platform:'linux',capabilities:['filesystem'],projects:[],metadata:{ownerUserId:f.user}});
 const app=buildHttpApp(validateConfig({endpointSecret:'e'.repeat(48),actionsSecret:'a'.repeat(48),roots:[]})),original=AuditStore.prototype.write;
 try{
  const login=await app.inject({method:'POST',url:'/api/auth/login',payload:{username:f.user,password}});assert.equal(login.statusCode,200);
  AuditStore.prototype.write=async()=>{throw new Error('fixture audit unavailable')};
  const response=await app.inject({method:'POST',url:`/api/account/nodes/${encodeURIComponent(nodeId)}/credentials/rotate`,headers:{authorization:`Bearer ${login.json().token}`},payload:{ttlMs:300000}});
  assert.equal(response.statusCode,503);assert.doesNotMatch(response.body,/fixture audit unavailable/);
  const row=(await db().query('SELECT pending_credential_hash,pending_credential_expires_at FROM execution_nodes WHERE id=$1',[nodeId])).rows[0];
  assert.equal(row.pending_credential_hash,null);assert.equal(row.pending_credential_expires_at,null);
  assert.ok(await NodeRegistry.resolveIdentity(nodeId,registered.nodeSecret),'failed audited rotation must leave current credential valid');
 }finally{AuditStore.prototype.write=original;await app.close()}
});

test('QUOTA-01 concurrent local admissions cannot exceed maxConcurrent',async()=>{
 const f=await fixture(),nodes=new NodeRegistry(f.a),nodeId=id('quota-node');await nodes.register({nodeId,name:'quota node',platform:'linux',capabilities:['filesystem'],projects:['fixture']});
 await db().query('INSERT INTO workspace_quotas(workspace_id,max_concurrent,max_daily_executions,max_daily_estimated_cost_usd,max_daily_sandbox_minutes) VALUES($1,1,100,1000,1000) ON CONFLICT(workspace_id) DO UPDATE SET max_concurrent=1,max_daily_executions=100',[f.a]);
 const req=(key:string)=>nodes.enqueue({missionId:f.mission.id,stepId:'step-1',nodeId,project:'fixture',capability:'filesystem',operation:'read',payload:{root:'fixture',path:key}},{idempotencyKey:key});
 const settled=await Promise.allSettled([req('quota-a'),req('quota-b')]),ok=settled.filter(x=>x.status==='fulfilled'),failed=settled.filter(x=>x.status==='rejected') as PromiseRejectedResult[];
 assert.equal(ok.length,1);assert.equal(failed.length,1);assert.match(String(failed[0].reason),/WORKSPACE_QUOTA_EXCEEDED.*concurrent/i);
 assert.equal((await db().query("SELECT count(*)::int n FROM node_jobs WHERE workspace_id=$1 AND status IN ('queued','leased')",[f.a])).rows[0].n,1);
});

test('QUOTA-02 direct node enqueue and idempotent retry share the same atomic admission boundary',async()=>{
 const f=await fixture(),nodes=new NodeRegistry(f.a),nodeId=id('quota-idem-node');await nodes.register({nodeId,name:'quota idem',platform:'linux',capabilities:['filesystem'],projects:['fixture']});
 await db().query('INSERT INTO workspace_quotas(workspace_id,max_concurrent,max_daily_executions,max_daily_estimated_cost_usd,max_daily_sandbox_minutes) VALUES($1,1,100,1000,1000) ON CONFLICT(workspace_id) DO UPDATE SET max_concurrent=1,max_daily_executions=100',[f.a]);
 const input={missionId:f.mission.id,stepId:'step-1',nodeId,project:'fixture',capability:'filesystem' as const,operation:'read',payload:{root:'fixture',path:'same'}};
 const first=await nodes.enqueue(input,{idempotencyKey:'quota-same'}),again=await nodes.enqueue(input,{idempotencyKey:'quota-same'});
 assert.equal(again.id,first.id,'idempotent retry must resolve before quota rejection');
 await assert.rejects(()=>nodes.enqueue({...input,payload:{root:'fixture',path:'different'}},{idempotencyKey:'quota-different'}),/WORKSPACE_QUOTA_EXCEEDED.*concurrent/i);
});

test('QUOTA-03 workspace usage includes active hosted execution work items',async()=>{
 const f=await fixture();
 await db().query('INSERT INTO workspace_quotas(workspace_id,max_concurrent,max_daily_executions,max_daily_estimated_cost_usd,max_daily_sandbox_minutes) VALUES($1,1,100,1000,1000) ON CONFLICT(workspace_id) DO UPDATE SET max_concurrent=1,max_daily_executions=100',[f.a]);
 await db().query("INSERT INTO work_items(id,instance_id,mission_id,step_id,kind,status,payload,attempts,max_attempts,workspace_id) VALUES($1,$2,$3,'step-1','hosted_execution','queued','{}',0,2,$4)",[id('hosted-active'),process.env.FS_REMOTE_INSTANCE_ID,f.mission.id,f.a]);
 const usage=await new AccountingStore(f.a).usage(),gate=await new AccountingStore(f.a).gate();
 assert.equal(usage.active,1);assert.equal(gate.allowed,false);assert.match(gate.failures.join(' '),/concurrent/i);
});

test('QUOTA-04 active admissions count against the daily execution ceiling before completion',async()=>{
 const f=await fixture(),nodes=new NodeRegistry(f.a),nodeId=id('quota-daily-node');await nodes.register({nodeId,name:'quota daily',platform:'linux',capabilities:['filesystem'],projects:['fixture']});
 await db().query('INSERT INTO workspace_quotas(workspace_id,max_concurrent,max_daily_executions,max_daily_estimated_cost_usd,max_daily_sandbox_minutes) VALUES($1,10,1,1000,1000) ON CONFLICT(workspace_id) DO UPDATE SET max_concurrent=10,max_daily_executions=1',[f.a]);
 const input={missionId:f.mission.id,stepId:'step-1',nodeId,project:'fixture',capability:'filesystem' as const,operation:'read',payload:{root:'fixture',path:'one'}};
 await nodes.enqueue(input,{idempotencyKey:'daily-one'});
 const usage=await new AccountingStore(f.a).usage();assert.equal(usage.dailyExecutions,1);
 await assert.rejects(()=>nodes.enqueue({...input,payload:{root:'fixture',path:'two'}},{idempotencyKey:'daily-two'}),/WORKSPACE_QUOTA_EXCEEDED.*daily execution/i);
});

test('TENANT-AUTH-01 workspace status changes cannot disable a multi-workspace account globally',async()=>{
 const {AuthStore}=await import('../../src/auth-store.js');
 const f=await fixture(),secondOwner=id('second-owner'),tokenA=crypto.randomBytes(32).toString('hex'),tokenB=crypto.randomBytes(32).toString('hex');
 await db().query('INSERT INTO users(id,username,password_hash) VALUES($1,$1,$2)',[secondOwner,'fixture-hash']);
 await db().query("INSERT INTO workspace_memberships(workspace_id,user_id,role) VALUES($1,$2,'owner')",[f.a,secondOwner]);
 await db().query("INSERT INTO user_sessions(id,token_hash,user_id,workspace_id,expires_at) VALUES($1,$2,$3,$4,now()+interval '1 hour'),($5,$6,$3,$7,now()+interval '1 hour')",[id('session-a'),hashOpaqueToken(tokenA),f.user,f.a,id('session-b'),hashOpaqueToken(tokenB),f.b]);
 const store=new AuthStore(),changed=await store.setStatus(f.a,f.user,'disabled');assert.equal(changed.status,'disabled');
 const memberships=(await db().query('SELECT workspace_id,status FROM workspace_memberships WHERE user_id=$1 ORDER BY workspace_id',[f.user])).rows;
 assert.equal(memberships.find(x=>x.workspace_id===f.a).status,'disabled');assert.equal(memberships.find(x=>x.workspace_id===f.b).status,'active');
 assert.equal((await db().query('SELECT status FROM users WHERE id=$1',[f.user])).rows[0].status,'active','workspace administration must not mutate global account status');
 assert.equal(await store.resolve(tokenA),null);assert.equal((await store.resolve(tokenB))?.workspaceId,f.b);
});

test('TENANT-AUTH-02 workspace admin cannot issue a global password reset for a multi-workspace user',async()=>{
 const {AuthStore}=await import('../../src/auth-store.js');const f=await fixture(),store=new AuthStore();
 await assert.rejects(()=>store.resetToken(f.a,f.user,id('admin')),/account-level|multiple|workspace/i);
 const single=id('single-workspace-user');await db().query('INSERT INTO users(id,username,password_hash) VALUES($1,$1,$2)',[single,'fixture-hash']);await db().query("INSERT INTO workspace_memberships(workspace_id,user_id,role) VALUES($1,$2,'engineer')",[f.a,single]);
 const issued=await store.resetToken(f.a,single,id('admin'));assert.ok(issued.token);assert.match(issued.expiresAt,/T/);
});

test('TENANT-ISOLATION-01 workspace A cannot read workspace B nodes jobs credentials connections or usage',{timeout:30000},async()=>{
 const {buildHttpApp}=await import('../../src/http.js');
 const f=await fixture(),tokenA=crypto.randomBytes(32).toString('hex'),nodeA=id('iso-node-a'),nodeB=id('iso-node-b');
 await db().query("INSERT INTO user_sessions(id,token_hash,user_id,workspace_id,expires_at) VALUES($1,$2,$3,$4,now()+interval '1 hour')",[id('iso-session-a'),hashOpaqueToken(tokenA),f.user,f.a]);
 await db().query("INSERT INTO provider_credentials(workspace_id,user_id,provider,label,secret_envelope) VALUES($1,$3,'fixture-provider','A credential',$4),($2,$3,'fixture-provider','B credential',$5)",[f.a,f.b,f.user,{ciphertext:'a-private'},{ciphertext:'b-private'}]);
 await db().query("INSERT INTO oauth_connections(id,workspace_id,user_id,client_id,scopes,status) VALUES($1,$2,$4,'gpt-a','[]','active'),($3,$5,$4,'gpt-b','[]','active')",[id('conn-a'),f.a,id('conn-b'),f.user,f.b]);
 await new AccountingStore(f.a).record({executionTarget:'local',wallClockMs:10,estimatedCostUsd:1},f.mission.id,'step-1');
 await new AccountingStore(f.b).record({executionTarget:'local',wallClockMs:10,estimatedCostUsd:7});
 const aNodes=new NodeRegistry(f.a),bNodes=new NodeRegistry(f.b),regA=await aNodes.register({nodeId:nodeA,name:'A node',platform:'linux',capabilities:['filesystem'],projects:['fixture']}),regB=await bNodes.register({nodeId:nodeB,name:'B node',platform:'linux',capabilities:['filesystem'],projects:['fixture']});
 const jobA=await aNodes.enqueue({missionId:f.mission.id,stepId:'step-1',nodeId:nodeA,project:'fixture',capability:'filesystem',operation:'read',payload:{root:'fixture',path:'a.txt'}},{idempotencyKey:'tenant-isolation-job-a'});
 assert.equal(await bNodes.getJob(jobA.id),null);assert.equal((await bNodes.missionJobs(f.mission.id,'step-1')).length,0);
 const usageA=await new AccountingStore(f.a).usage(),usageB=await new AccountingStore(f.b).usage();assert.equal(usageA.dailyEstimatedCostUsd,1);assert.equal(usageB.dailyEstimatedCostUsd,7);
 const app=buildHttpApp(validateConfig({endpointSecret:'e'.repeat(48),actionsSecret:'a'.repeat(48),roots:[]}));
 try{
  const headers={authorization:`Bearer ${tokenA}`};
  const providers=await app.inject({method:'GET',url:'/api/account/providers',headers});assert.equal(providers.statusCode,200);assert.deepEqual(providers.json().providers.map((x:any)=>x.label),['A credential']);assert.doesNotMatch(providers.body,/b-private|secret_envelope/i);
  const nodes=await app.inject({method:'GET',url:'/api/account/nodes',headers});assert.equal(nodes.statusCode,200);assert.deepEqual(nodes.json().nodes.map((x:any)=>x.id),[nodeA]);assert.doesNotMatch(nodes.body,new RegExp(nodeB));
  const gpt=await app.inject({method:'GET',url:'/api/account/gpt',headers});assert.equal(gpt.statusCode,200);assert.deepEqual(gpt.json().connections.map((x:any)=>x.client_id),['gpt-a']);
 }finally{await app.close()}
 assert.ok(await NodeRegistry.resolveIdentity(nodeA,regA.nodeSecret));assert.ok(await NodeRegistry.resolveIdentity(nodeB,regB.nodeSecret));
});
test('WORKER-OBS-01 durable worker heartbeat tracks session, revision and restarts without exposing secrets',async()=>{
 const {WorkerRuntimeStore}=await import('../../src/worker-runtime-store.js');
 const store=new WorkerRuntimeStore('autonomous-worker');
 const first=await store.start({sessionId:'session-a',workerId:'worker-a',serviceVersion:'3.0.0-dev',deploymentRevision:'abc123'});
 assert.equal(first.state,'healthy');assert.equal(first.restartCount,0);assert.equal(first.deploymentRevision,'abc123');
 await store.heartbeat('session-a','worker-a');
 const same=await store.start({sessionId:'session-a',workerId:'worker-a',serviceVersion:'3.0.0-dev',deploymentRevision:'abc123'});assert.equal(same.restartCount,0);
 const restarted=await store.start({sessionId:'session-b',workerId:'worker-b',serviceVersion:'3.0.0-dev',deploymentRevision:'def456'});assert.equal(restarted.restartCount,1);assert.equal(restarted.deploymentRevision,'def456');
 assert.equal(await store.heartbeat('session-a','worker-a'),false,'stale process session cannot refresh the new worker heartbeat');
 assert.equal(await store.heartbeat('session-b','worker-b'),true);
 const serialized=JSON.stringify(await store.snapshot());assert.doesNotMatch(serialized,/token|secret|credential/i);
});

test('WORKER-OBS-02 stale heartbeat is explicit and never reported healthy',async()=>{
 const {WorkerRuntimeStore}=await import('../../src/worker-runtime-store.js');
 const store=new WorkerRuntimeStore('stale-worker');
 await store.start({sessionId:'session-stale',workerId:'worker-stale',serviceVersion:'3.0.0-dev'});
 await db().query("UPDATE worker_runtime_status SET last_heartbeat_at=clock_timestamp()-interval '2 minutes' WHERE instance_id=$1 AND role='stale-worker'",[schema]);
 const snap=await store.snapshot(30000);assert.ok(snap);assert.equal(snap.state,'stale');assert.ok(snap.heartbeatAgeMs>=100000);
});

test('WORKER-OBS-03 operator telemetry reports scoped queue, node, lease and database progress',async()=>{
 const {WorkerRuntimeStore,ProductionOperatorTelemetry}=await import('../../src/worker-runtime-store.js');
 const f=await fixture(),worker=new WorkerRuntimeStore('autonomous-worker');await worker.start({sessionId:'operator-session',workerId:'operator-worker',serviceVersion:'3.0.0-dev',deploymentRevision:'rev-operator'});
 const queue=new WorkerQueue(path.join(f.dir,'operator-q'),120000,f.a);const work=await queue.enqueue({missionId:f.mission.id,stepId:'step-1',kind:'reasoning'});const claimed=await queue.claim('operator-worker',['reasoning'],120000);assert.equal(claimed?.id,work.id);
 const nodes=new NodeRegistry(f.a),nodeId=id('operator-node');const reg=await nodes.register({nodeId,name:'operator node',platform:'linux',capabilities:['filesystem'],projects:['fixture'],metadata:{readiness:{schemaVersion:'fs.node.readiness.v1',ok:true,checkedAt:new Date().toISOString(),platform:'linux',arch:'x64',node:'v22',shell:'bash',checks:[]},agent:{schemaVersion:'fs.node.agent.v1',serviceVersion:'3.0.0-dev',protocolVersion:1,platform:'linux',arch:'x64',node:'v22'}}});
 await nodes.heartbeat(nodeId,reg.nodeSecret);
 await nodes.enqueue({missionId:f.mission.id,stepId:'step-1',nodeId,project:'fixture',capability:'filesystem',operation:'read',payload:{root:'fixture',path:'x'}},{idempotencyKey:'operator-telemetry-job'});
 const telemetry=await new ProductionOperatorTelemetry(f.a).snapshot();
 assert.equal(telemetry.worker.role,'autonomous-worker');assert.equal(telemetry.worker.state,'healthy');assert.equal(telemetry.worker.deploymentRevision,'rev-operator');
 assert.ok(telemetry.database.latencyMs>=0);assert.equal(telemetry.database.healthy,true);
 assert.equal(telemetry.queue.workItems.leased,1);assert.equal(telemetry.queue.nodeJobs.queued,1);assert.equal(telemetry.queue.recoveryRequired,0);
 assert.ok(telemetry.nodes.total>=1);assert.ok(telemetry.nodes.byLifecycle.ready>=1);
 assert.ok('leasesExpiringSoon' in telemetry.queue);assert.ok('lastSuccessfulWorkAt' in telemetry.queue);
 assert.equal(JSON.stringify(telemetry).includes(reg.nodeSecret),false);
});
test('WORKER-OBS-04 operator_status surfaces durable production telemetry',async()=>{
 const {RemoteOperations}=await import('../../src/operations.js'),{ProcessManager}=await import('../../src/processes.js'),{WorkerRuntimeStore}=await import('../../src/worker-runtime-store.js');
 const f=await fixture();await new WorkerRuntimeStore('autonomous-worker').start({sessionId:'ops-session',workerId:'ops-worker',serviceVersion:'3.0.0-dev',deploymentRevision:'ops-rev'});
 const config=validateConfig({host:'127.0.0.1',port:0,endpointSecret:'e'.repeat(48),actionsSecret:'a'.repeat(48),roots:[]});
 const ops=new RemoteOperations(config,new ProcessManager({shell:'powershell.exe',maxOutputBytes:10000,stateDir:path.join(f.dir,'processes')}),undefined,undefined,f.a);
 const snapshot:any=await ops.operatorStatusSnapshot();assert.equal(snapshot.production.worker.state,'healthy');assert.equal(snapshot.production.database.healthy,true);assert.equal(snapshot.production.workspaceId,f.a);
});

test('WORKER-OBS-05 real autonomous-worker process publishes a session-fenced heartbeat',{timeout:25000},async()=>{
 const {spawn}=await import('node:child_process');const childInstance='worker-observe-'+crypto.randomBytes(5).toString('hex'),state=await fs.mkdtemp(path.join(os.tmpdir(),'fs-worker-observe-'));dirs.push(state);let log='';
 const child=spawn(process.execPath,['--import','tsx',path.resolve('src/executor-main.ts')],{cwd:process.cwd(),env:{...process.env,DATABASE_URL:process.env.DATABASE_URL!,FS_REMOTE_INSTANCE_ID:childInstance,FS_REMOTE_STATE_ROOT:state,FS_REMOTE_WORKER_HEARTBEAT_MS:'500',FS_REMOTE_WORKER_POLL_MS:'60000',FS_REMOTE_SUPERVISOR_SCAN_MS:'60000',OPENROUTER_API_KEY:'',OPENAI_API_KEY:'',NVIDIA_API_KEY:''},stdio:['ignore','pipe','pipe']});
 child.stdout.setEncoding('utf8').on('data',x=>log+=x);child.stderr.setEncoding('utf8').on('data',x=>log+=x);
 try{
  const end=Date.now()+12000;let row:any=null;while(Date.now()<end){row=(await db().query("SELECT * FROM worker_runtime_status WHERE instance_id=$1 AND role='autonomous-worker'",[childInstance])).rows[0];if(row)break;if(child.exitCode!==null)throw new Error('worker exited before heartbeat: '+log.slice(-2000));await new Promise(r=>setTimeout(r,100));}
  assert.ok(row,'worker heartbeat row was not published: '+log.slice(-2000));const first=new Date(row.last_heartbeat_at).getTime();await new Promise(r=>setTimeout(r,900));
  const next=(await db().query("SELECT * FROM worker_runtime_status WHERE instance_id=$1 AND role='autonomous-worker'",[childInstance])).rows[0];assert.equal(next.session_id,row.session_id);assert.equal(next.worker_id,row.worker_id);assert.ok(new Date(next.last_heartbeat_at).getTime()>first);
 }finally{if(child.exitCode===null){child.kill('SIGTERM');await new Promise<void>(resolve=>{const timer=setTimeout(resolve,3000);child.once('exit',()=>{clearTimeout(timer);resolve()})})}}
});


test('WORKER-OBS-06 owner/admin operator endpoint is workspace-scoped, role-protected and emits configured alerts', async () => {
  const f=await fixture(), ownerToken=crypto.randomBytes(32).toString('hex'), viewer=id('ops-viewer'), viewerToken=crypto.randomBytes(32).toString('hex');
  await db().query("INSERT INTO user_sessions(id,token_hash,user_id,workspace_id,expires_at) VALUES($1,$2,$3,$4,now()+interval '1 hour')",[id('ops-owner-session'),hashOpaqueToken(ownerToken),f.user,f.a]);
  await db().query('INSERT INTO users(id,username,password_hash) VALUES($1,$1,$2)',[viewer,'fixture-hash']);
  await db().query("INSERT INTO workspace_memberships(workspace_id,user_id,role) VALUES($1,$2,'viewer')",[f.a,viewer]);
  await db().query("INSERT INTO user_sessions(id,token_hash,user_id,workspace_id,expires_at) VALUES($1,$2,$3,$4,now()+interval '1 hour')",[id('ops-viewer-session'),hashOpaqueToken(viewerToken),viewer,f.a]);
  const {WorkerRuntimeStore}=await import('../../src/worker-runtime-store.js');
  await new WorkerRuntimeStore('autonomous-worker').start({sessionId:id('ops-session'),workerId:id('ops-worker'),serviceVersion:'3.0.0-dev',deploymentRevision:'ops-endpoint-rev'});
  const unsafe=await f.queue.enqueue({missionId:f.mission.id,stepId:'step-1',kind:'hosted_git'});
  const claim=await f.queue.claim('ops-fixture-worker',['hosted_git']);
  await f.queue.fail(unsafe.id,'ops-fixture-worker',claim!.lease!.token,'fixture uncertainty',true);
  const old=process.env.FS_ALERT_MAX_RECOVERY_REQUIRED;process.env.FS_ALERT_MAX_RECOVERY_REQUIRED='0';
  const app=Fastify();registerAuthRoutes(app);
  try{
    const owner=await app.inject({method:'GET',url:'/api/admin/operator-status',headers:{authorization:`Bearer ${ownerToken}`}});
    assert.equal(owner.statusCode,200,owner.body);
    const body=owner.json();
    assert.equal(body.telemetry.workspaceId,f.a);
    assert.equal(body.telemetry.worker.role,'autonomous-worker');
    assert.ok(body.telemetry.queue.recoveryRequired>=1);
    assert.ok(body.alerts.some((x:any)=>x.code==='recovery_backlog'));
    assert.equal(body.thresholdsConfigured.recoveryRequired,true);
    assert.doesNotMatch(owner.body,/leaseToken|credential_hash|password_hash/i);
    const denied=await app.inject({method:'GET',url:'/api/admin/operator-status',headers:{authorization:`Bearer ${viewerToken}`}});
    assert.equal(denied.statusCode,403);
  }finally{
    await app.close();
    if(old===undefined)delete process.env.FS_ALERT_MAX_RECOVERY_REQUIRED;else process.env.FS_ALERT_MAX_RECOVERY_REQUIRED=old;
  }
});


test('EXEC-CORRELATION-01 PostgreSQL worker completion binds result and evidence to one work identity',async()=>{
 const f=await fixture(),item=await f.queue.enqueue({missionId:f.mission.id,stepId:'step-1',kind:'hosted_execution'}),claim=await f.queue.claim('correlation-worker',['hosted_execution'],120000);
 assert.equal(claim?.id,item.id);assert.ok(claim?.lease);
 const completed=await f.queue.completeWithEvidence(f.manager,item.id,'correlation-worker',claim!.lease!.token,{ok:true},[{kind:'test',source:'test:correlation',status:'pass',summary:'correlated worker proof'}],{executionTarget:'hosted',wallClockMs:3,estimatedCostUsd:0});
 assert.equal((completed.result as any)?.executionId,item.id);
 const row=(await db().query('SELECT payload FROM evidence WHERE mission_id=$1 AND step_id=$2 AND source=$3',[f.mission.id,'step-1','test:correlation'])).rows[0];
 assert.equal(row.payload.executionId,item.id);
});

test('EXEC-CORRELATION-02 PostgreSQL node completion binds result and evidence to one node job identity',async()=>{
 const f=await nodeFixture();
 const completed=await f.nodes.complete(f.nodeId,f.secret,f.job.id,f.claimed.leaseToken,{exitCode:0,timedOut:false},'completed');
 assert.equal(completed.result.executionId,f.job.id);
 const evidence=(await db().query('SELECT payload FROM evidence WHERE id=$1',['node-'+f.job.id])).rows[0];
 assert.equal(evidence.payload.executionId,f.job.id);
 assert.equal(evidence.payload.jobId,f.job.id);
});

test('RETENTION-LIFECYCLE-01 cleanup removes only expired ephemeral records in the requested workspace', async () => {
  const f = await fixture();
  const activeSession = id('active-session'), expiredSessionA = id('expired-session-a'), expiredSessionB = id('expired-session-b');
  await db().query("INSERT INTO invitations(id,token_hash,workspace_id,intended_email,role,expires_at,created_by,use_count,max_uses) VALUES($1,$2,$3,'old@example.test','engineer',now()-interval '1 day',$4,0,1),($5,$6,$7,'other@example.test','engineer',now()-interval '1 day',$4,0,1),($8,$9,$3,'new@example.test','engineer',now()+interval '1 day',$4,0,1)",[id('invite-old-a'),hashOpaqueToken(id('tok')),f.a,f.user,id('invite-old-b'),hashOpaqueToken(id('tok')),f.b,id('invite-active-a'),hashOpaqueToken(id('tok'))]);
  await db().query("INSERT INTO user_sessions(id,token_hash,user_id,workspace_id,expires_at) VALUES($1,$2,$3,$4,now()-interval '1 day'),($5,$6,$3,$7,now()-interval '1 day'),($8,$9,$3,$4,now()+interval '1 day')",[expiredSessionA,hashOpaqueToken(id('sess')),f.user,f.a,expiredSessionB,hashOpaqueToken(id('sess')),f.b,activeSession,hashOpaqueToken(id('sess'))]);
  await db().query("INSERT INTO password_reset_tokens(id,token_hash,user_id,workspace_id,expires_at,consumed_at) VALUES($1,$2,$3,$4,now()-interval '1 day',NULL),($5,$6,$3,$7,now()-interval '1 day',NULL),($8,$9,$3,$4,now()+interval '1 day',NULL)",[id('reset-old-a'),hashOpaqueToken(id('reset')),f.user,f.a,id('reset-old-b'),hashOpaqueToken(id('reset')),f.b,id('reset-active-a'),hashOpaqueToken(id('reset'))]);
  await db().query("INSERT INTO oauth_authorization_codes(code_hash,workspace_id,user_id,client_id,redirect_uri,scopes,expires_at,consumed_at) VALUES($1,$2,$3,'fs-chatgpt','https://chat.openai.com/a','[]'::jsonb,now()-interval '1 day',NULL),($4,$5,$3,'fs-chatgpt','https://chat.openai.com/b','[]'::jsonb,now()-interval '1 day',NULL),($6,$2,$3,'fs-chatgpt','https://chat.openai.com/c','[]'::jsonb,now()+interval '1 day',NULL)",[hashOpaqueToken(id('code')),f.a,f.user,hashOpaqueToken(id('code')),f.b,hashOpaqueToken(id('code'))]);
  await db().query("INSERT INTO oauth_access_tokens(token_hash,workspace_id,user_id,client_id,scopes,expires_at,revoked_at) VALUES($1,$2,$3,'fs-chatgpt','[]'::jsonb,now()-interval '1 day',NULL),($4,$5,$3,'fs-chatgpt','[]'::jsonb,now()-interval '1 day',NULL),($6,$2,$3,'fs-chatgpt','[]'::jsonb,now()+interval '1 day',NULL)",[hashOpaqueToken(id('access')),f.a,f.user,hashOpaqueToken(id('access')),f.b,hashOpaqueToken(id('access'))]);
  await db().query("INSERT INTO node_enrollments(id,workspace_id,user_id,token_hash,name,platform,projects,capabilities,expires_at,consumed_at) VALUES($1,$2,$3,$4,'old','linux','[]'::jsonb,'[]'::jsonb,now()-interval '1 day',NULL),($5,$6,$3,$7,'other','linux','[]'::jsonb,'[]'::jsonb,now()-interval '1 day',NULL),($8,$2,$3,$9,'new','linux','[]'::jsonb,'[]'::jsonb,now()+interval '1 day',NULL)",[id('enroll-old-a'),f.a,f.user,hashOpaqueToken(id('enroll')),id('enroll-old-b'),f.b,hashOpaqueToken(id('enroll')),id('enroll-active-a'),hashOpaqueToken(id('enroll'))]);
  const missionCountBefore=(await db().query('SELECT count(*)::int n FROM missions')).rows[0].n;
  const out = await new RetentionLifecycle(f.a).cleanupEphemeralCredentials();
  assert.deepEqual(out, {invitations:1,userSessions:1,passwordResetTokens:1,oauthAuthorizationCodes:1,oauthAccessTokens:1,nodeEnrollments:1,pendingNodeCredentialsCleared:0});
  assert.equal((await db().query('SELECT count(*)::int n FROM user_sessions WHERE workspace_id=$1',[f.a])).rows[0].n,1);
  assert.equal((await db().query('SELECT count(*)::int n FROM user_sessions WHERE workspace_id=$1',[f.b])).rows[0].n,1);
  assert.equal((await db().query('SELECT count(*)::int n FROM missions')).rows[0].n,missionCountBefore,'durable mission history is not part of ephemeral cleanup');
});

test('RETENTION-LIFECYCLE-02 cleanup clears expired pending node credentials but preserves active pending credentials', async () => {
  const f = await fixture();
  const nodes = new NodeRegistry(f.a), oldNode = id('old-node'), activeNode = id('active-node'), otherNode = id('other-node');
  await nodes.register({nodeId:oldNode,name:'old',platform:'linux',projects:['fixture'],capabilities:['command']});
  await nodes.register({nodeId:activeNode,name:'active',platform:'linux',projects:['fixture'],capabilities:['command']});
  await new NodeRegistry(f.b).register({nodeId:otherNode,name:'other',platform:'linux',projects:['fixture'],capabilities:['command']});
  await db().query("UPDATE execution_nodes SET pending_credential_hash='old-pending',pending_credential_expires_at=now()-interval '1 day' WHERE id=$1",[oldNode]);
  await db().query("UPDATE execution_nodes SET pending_credential_hash='active-pending',pending_credential_expires_at=now()+interval '1 day' WHERE id=$1",[activeNode]);
  await db().query("UPDATE execution_nodes SET pending_credential_hash='other-pending',pending_credential_expires_at=now()-interval '1 day' WHERE id=$1",[otherNode]);
  const out = await new RetentionLifecycle(f.a).cleanupEphemeralCredentials();
  assert.equal(out.pendingNodeCredentialsCleared,1);
  const rows=(await db().query('SELECT id,pending_credential_hash FROM execution_nodes WHERE id=ANY($1::text[]) ORDER BY id',[[oldNode,activeNode,otherNode]])).rows;
  assert.equal(rows.find((x:any)=>x.id===oldNode).pending_credential_hash,null);
  assert.equal(rows.find((x:any)=>x.id===activeNode).pending_credential_hash,'active-pending');
  assert.equal(rows.find((x:any)=>x.id===otherNode).pending_credential_hash,'other-pending');
});
