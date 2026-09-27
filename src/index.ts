import { buildHttpApp } from './http.js';
import { loadConfig } from './config.js';
import { migrateDatabase } from './db.js';
import { migrateMultiUserSchema } from './multi-user-schema.js';
import { bootstrapInitialOwner } from './bootstrap-owner.js';
import { acquireRuntimeOwnership } from './runtime-ownership.js';

const config = loadConfig();
let ownership: Awaited<ReturnType<typeof acquireRuntimeOwnership>> | undefined;
let app: ReturnType<typeof buildHttpApp> | undefined;

const stop = async (signal: string) => {
  console.log(`[fs-remote-mcp] ${signal} received; shutting down.`);
  if (app) await app.close();
  if (ownership) await ownership.release();
  process.exit(0);
};

process.on('SIGINT', () => { void stop('SIGINT'); });
process.on('SIGTERM', () => { void stop('SIGTERM'); });

try {
  ownership = await acquireRuntimeOwnership({ host: config.host, port: config.port });
  await migrateDatabase();
  await migrateMultiUserSchema();
  await bootstrapInitialOwner();
  app = buildHttpApp(config);
  await app.listen({ host: config.host, port: config.port });
  console.log(`[fs-remote-mcp] listening on http://${config.host}:${config.port}`);
  console.log('[fs-remote-mcp] capability URL is stored in config/local.json; keep it private.');
} catch (error) {
  if (ownership) await ownership.release();
  console.error('[fs-remote-mcp] startup failed', error);
  process.exit(1);
}
