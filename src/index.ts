import { buildHttpApp } from './http.js';
import { loadConfig } from './config.js';
import { migrateDatabase } from './db.js';
import { migrateMultiUserSchema } from './multi-user-schema.js';
import { bootstrapInitialOwner } from './bootstrap-owner.js';

const config = loadConfig();
await migrateDatabase();
await migrateMultiUserSchema();
await bootstrapInitialOwner();
const app = buildHttpApp(config);

const stop = async (signal: string) => {
  console.log(`[fs-remote-mcp] ${signal} received; shutting down.`);
  await app.close();
  process.exit(0);
};

process.on('SIGINT', () => { void stop('SIGINT'); });
process.on('SIGTERM', () => { void stop('SIGTERM'); });

try {
  await app.listen({ host: config.host, port: config.port });
  console.log(`[fs-remote-mcp] listening on http://${config.host}:${config.port}`);
  console.log('[fs-remote-mcp] capability URL is stored in config/local.json; keep it private.');
} catch (error) {
  console.error('[fs-remote-mcp] startup failed', error);
  process.exit(1);
}
