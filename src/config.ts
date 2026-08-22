import fs from 'node:fs';
import path from 'node:path';
import { type RootConfig } from './security.js';

export interface AppConfig {
  host: string;
  port: number;
  endpointSecret: string;
  actionsSecret: string;
  roots: RootConfig[];
  commandTimeoutMs: number;
  maxOutputBytes: number;
  shell: string;
  diagnosticsExternalBaseUrl: string;
}

interface RawConfig {
  host?: string;
  port?: number;
  endpointSecret?: string;
  actionsSecret?: string;
  roots?: RootConfig[];
  commandTimeoutMs?: number;
  maxOutputBytes?: number;
  shell?: string;
  diagnosticsExternalBaseUrl?: string;
}

export function validateConfig(raw: RawConfig): AppConfig {
  if (!raw.endpointSecret || raw.endpointSecret.length < 32) {
    throw new Error('endpointSecret must contain at least 32 characters.');
  }
  if (!raw.actionsSecret || raw.actionsSecret.length < 32) {
    throw new Error('actionsSecret must contain at least 32 characters.');
  }
  if (raw.actionsSecret === raw.endpointSecret) {
    throw new Error('actionsSecret must differ from endpointSecret.');
  }
  const roots = (raw.roots ?? []).map((root) => ({
    ...root,
    path: path.resolve(root.path),
  }));
  const names = new Set<string>();
  for (const root of roots) {
    if (!root.name?.trim()) throw new Error('Every root requires a non-empty name.');
    if (names.has(root.name)) throw new Error(`Duplicate root name: ${root.name}`);
    names.add(root.name);
  }
  return {
    host: raw.host ?? '127.0.0.1',
    port: raw.port ?? 8765,
    endpointSecret: raw.endpointSecret,
    actionsSecret: raw.actionsSecret,
    roots,
    commandTimeoutMs: raw.commandTimeoutMs ?? 120_000,
    maxOutputBytes: raw.maxOutputBytes ?? 2_000_000,
    shell: raw.shell ?? 'powershell.exe',
    diagnosticsExternalBaseUrl: raw.diagnosticsExternalBaseUrl ?? process.env.FS_REMOTE_PUBLIC_BASE_URL ?? 'https://fs.fs-mcp.com',
  };
}

export function loadConfig(configPath?: string): AppConfig {
  const target = path.resolve(configPath ?? process.env.FS_REMOTE_MCP_CONFIG ?? 'config/local.json');
  let raw: RawConfig = {};
  if (fs.existsSync(target)) {
    const content = fs.readFileSync(target, 'utf8');
    const source = content.charCodeAt(0) === 0xFEFF ? content.slice(1) : content;
    raw = JSON.parse(source) as RawConfig;
  }
  const env = process.env;
  return validateConfig({
    ...raw,
    host: env.HOST ?? env.FS_REMOTE_HOST ?? raw.host,
    port: Number(env.PORT ?? env.FS_REMOTE_PORT ?? raw.port ?? 8765),
    endpointSecret: env.FS_REMOTE_ENDPOINT_SECRET ?? raw.endpointSecret,
    actionsSecret: env.FS_REMOTE_ACTIONS_SECRET ?? raw.actionsSecret,
    diagnosticsExternalBaseUrl: env.FS_REMOTE_PUBLIC_BASE_URL ?? raw.diagnosticsExternalBaseUrl,
    shell: env.FS_REMOTE_SHELL ?? raw.shell,
  });
}
