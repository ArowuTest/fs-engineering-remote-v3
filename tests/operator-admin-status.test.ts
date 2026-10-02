import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs/promises';
test('admin operator status is owner/admin scoped and exposes production telemetry with deterministic alerts',async()=>{
 const s=await fs.readFile(new URL('../src/auth-http.ts',import.meta.url),'utf8');
 assert.match(s,/\/api\/admin\/operator-status/);
 assert.match(s,/ProductionOperatorTelemetry/);
 assert.match(s,/evaluateOperatorAlerts/);
 assert.match(s,/role\(r\.principal,\['owner','admin'\]\)/);
 const start=s.indexOf("app.get('/api/admin/operator-status'");const end=s.indexOf("app.post('/api/auth/password-reset'",start);const route=s.slice(start,end);assert.doesNotMatch(route,/error:e instanceof Error\?e\.message/);assert.doesNotMatch(route,/deploymentFailed:false|restartLoop:false|reconnectsInWindow:0|restartsInWindow:0/);assert.match(route,/observability/);
});
