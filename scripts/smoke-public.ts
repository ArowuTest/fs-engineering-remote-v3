import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { loadConfig } from '../src/config.js';

const baseUrl = process.argv[2];
if (!baseUrl) {
  console.error('Usage: npx tsx scripts/smoke-public.ts https://your-domain.example');
  process.exit(2);
}

const config = loadConfig();
const endpoint = new URL(`/mcp/${config.endpointSecret}`, baseUrl);
const client = new Client({ name: 'fs-remote-smoke', version: '1.0.0' });

try {
  await client.connect(new StreamableHTTPClientTransport(endpoint));
  const tools = await client.listTools();
  console.log(`MCP_OK tools=${tools.tools.length}`);
  console.log(tools.tools.map((tool) => tool.name).sort().join(','));
  const commandResult = await client.callTool({
    name: 'run_command',
    arguments: { root: 'fs-remote-mcp', command: "Write-Output 'PUBLIC_COMMAND_OK'" },
  });
  console.log(JSON.stringify(commandResult).includes('PUBLIC_COMMAND_OK') ? 'COMMAND_OK' : 'COMMAND_BAD');
  const blocked = await client.callTool({
    name: 'run_command',
    arguments: { root: 'fs-remote-mcp', command: 'git push origin main' },
  }).catch((error) => ({ error: String(error) }));
  const blockedText = JSON.stringify(blocked);
  console.log(/git push|disabled by policy/i.test(blockedText) ? 'GIT_PUSH_BLOCKED' : 'GIT_PUSH_CHECK_FAILED');
} finally {
  await client.close();
}
