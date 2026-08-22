import Fastify, { type FastifyInstance } from 'fastify';
import { createMcpHandler } from '@modelcontextprotocol/server';
import { toNodeHandler } from '@modelcontextprotocol/node';
import { registerActionsRoutes } from './actions.js';
import { type AppConfig } from './config.js';
import { createRemoteOperations } from './operations.js';
import { ProcessManager } from './processes.js';
import { createRemoteServer } from './server.js';

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
    if (request.headers.origin) {
      await reply.code(403).send({ error: 'Browser-origin requests are not accepted.' });
    }
  });

  app.get('/healthz', async () => ({
    ok: true,
    service: 'fs-remote-mcp',
    roots: config.roots.length,
  }));
  registerActionsRoutes(app, config, operations);

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