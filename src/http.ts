import Fastify, { type FastifyInstance } from 'fastify';
import { createMcpHandler } from '@modelcontextprotocol/server';
import { toNodeHandler } from '@modelcontextprotocol/node';
import { registerActionsRoutes } from './actions.js';
import { type AppConfig } from './config.js';
import { createRemoteOperations } from './operations.js';
import { ProcessManager } from './processes.js';
import { createRemoteServer } from './server.js';
import { databaseHealth } from './db.js';
import { registerNodeRoutes } from './node-http.js';
import { HostedEngineering } from './hosted-engineering.js';
import { registerAuthRoutes } from './auth-http.js';
import { registerPortal } from './portal.js';
import { registerUserPlatformRoutes } from './user-platform-http.js';
import { registerOAuthRoutes } from './oauth-http.js';

export function buildHttpApp(config: AppConfig): FastifyInstance {
  const processes = new ProcessManager({
    shell: config.shell,
    maxOutputBytes: config.maxOutputBytes,
  });
  const operations = createRemoteOperations(config, processes);
  const handler = createMcpHandler(() => createRemoteServer(config, processes, operations));
  const nodeHandler = toNodeHandler(handler, {
    onerror: (error) => console.error('[mcp-adapter]', error),
  });
  const app = Fastify({ logger: false, bodyLimit: 1_000_000 });

  app.addHook('onRequest', async (request, reply) => {
    if (request.headers.origin && !request.url.startsWith('/portal') && !request.url.startsWith('/api/')) {
      await reply.code(403).send({ error: 'Browser-origin requests are not accepted.' });
    }
  });

  app.get('/healthz', async () => {
    const database = await databaseHealth();
    return {
      ok: !database.configured || database.healthy,
      service: 'fs-engineering-remote-v3',
      version: '3.0.0-dev',
      environment: process.env.FS_REMOTE_ENVIRONMENT ?? 'development',
      roots: config.roots.length,
      database,
    };
  });
  registerActionsRoutes(app, config, operations);
  registerNodeRoutes(app, config);
  registerAuthRoutes(app);
  registerPortal(app);
  registerUserPlatformRoutes(app);
  registerOAuthRoutes(app);
  const hosted = new HostedEngineering(process.env.FS_HOSTED_WORK_ROOT ?? 'runtime/hosted-work');
  const hostedAuth = async (request: any, reply: any) => {
    const secret = process.env.FS_HOSTED_ENGINEERING_SECRET ?? '';
    if (!secret || request.headers.authorization !== `Bearer ${secret}`) return reply.code(401).send({ error: 'Unauthorized.' });
  };
  app.post('/hosted-engineering/jobs', { preHandler: hostedAuth }, async (request: any, reply) => {
    try { const job = await hosted.submit(request.body); return reply.code(202).send({ jobId: job.id, workspaceId: job.workspaceId, status: job.status }); }
    catch (error) { return reply.code(400).send({ error: error instanceof Error ? error.message : 'Invalid hosted engineering job.' }); }
  });
  app.get('/hosted-engineering/jobs/:id', { preHandler: hostedAuth }, async (request: any, reply) => {
    try { const workspaceId = String(request.query?.workspaceId ?? ''); if (!workspaceId) return reply.code(400).send({ error: 'workspaceId is required.' }); return reply.send({ job: await hosted.get(workspaceId, request.params.id) }); }
    catch (error) { return reply.code(404).send({ error: error instanceof Error ? error.message : 'Not found.' }); }
  });

  app.all(`/mcp/${config.endpointSecret}`, async (request, reply) => {
    await nodeHandler(request.raw, reply.raw, request.body);
  });

  app.all('/mcp', async (_request, reply) => {
    await reply.code(404).send({ error: 'Not found.' });
  });

  app.addHook('onClose', async () => {
    await handler.close();
  });

  return app;
}