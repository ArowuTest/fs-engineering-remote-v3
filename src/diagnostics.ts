import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { AppConfig } from './config.js';
import { SERVICE_VERSION } from './version.js';

const execFileAsync = promisify(execFile);
export type DiagnosticState = 'healthy' | 'running' | 'connected' | 'available' | 'down' | 'unavailable' | 'unknown';

export interface RuntimeProbe {
  localHealth(): Promise<boolean>;
  cloudflaredRunning(): Promise<boolean>;
  externalHealth(): Promise<boolean>;
  openApiAvailable(): Promise<boolean>;
  actionsAuthAvailable(): Promise<boolean>;
}

async function fetchOk(url: string, init?: RequestInit): Promise<boolean> {
  try {
    const response = await fetch(url, { ...init, signal: AbortSignal.timeout(4000) });
    return response.ok;
  } catch {
    return false;
  }
}

export function createRuntimeProbe(config: AppConfig): RuntimeProbe {
  const localBase = `http://${config.host}:${config.port}`;
  const externalBase = config.diagnosticsExternalBaseUrl.replace(/\/$/, '');
  return {
    localHealth: () => fetchOk(`${localBase}/healthz`),
    async cloudflaredRunning() {
      try {
        if (process.platform === 'win32') {
          const { stdout } = await execFileAsync('tasklist.exe', ['/FI', 'IMAGENAME eq cloudflared.exe', '/FO', 'CSV', '/NH'], { windowsHide: true });
          return /cloudflared\.exe/i.test(stdout);
        }
        const { stdout } = await execFileAsync('pgrep', ['-x', 'cloudflared']);
        return stdout.trim().length > 0;
      } catch {
        return false;
      }
    },
    externalHealth: () => fetchOk(`${externalBase}/healthz`),
    openApiAvailable: () => fetchOk(`${externalBase}/openapi.json`),
    actionsAuthAvailable: () => fetchOk(`${externalBase}/actions/health`, {
      headers: { authorization: `Bearer ${config.actionsSecret}` },
    }),
  };
}

export class RuntimeDiagnostics {
  constructor(private readonly config: AppConfig, private readonly probe: RuntimeProbe = createRuntimeProbe(config)) {}

  async diagnose() {
    const serverHealthy = await this.probe.localHealth();
    if (!serverHealthy) {
      return {
        agent: 'FS Engineering Remote v2',
        version: SERVICE_VERSION,
        environment: 'validation / development',
        endpoint: this.config.diagnosticsExternalBaseUrl,
        server: 'down' as const,
        server_process: 'unknown' as const,
        health_endpoint: '/healthz',
        port: this.config.port,
        cloudflared: 'unknown' as const,
        tunnel: 'unknown' as const,
        external_endpoint: 'unknown' as const,
        openapi: 'unknown' as const,
        actions_auth: 'unknown' as const,
        summary: 'FS Remote server is not running. Tunnel status cannot be evaluated.',
      };
    }

    const cloudflared = await this.probe.cloudflaredRunning();
    if (!cloudflared) {
      return {
        agent: 'FS Engineering Remote v2',
        version: SERVICE_VERSION,
        environment: 'validation / development',
        endpoint: this.config.diagnosticsExternalBaseUrl,
        server: 'healthy' as const,
        server_process: 'running' as const,
        health_endpoint: '/healthz',
        port: this.config.port,
        cloudflared: 'down' as const,
        tunnel: 'down' as const,
        external_endpoint: 'unavailable' as const,
        openapi: 'unavailable' as const,
        actions_auth: 'unavailable' as const,
        summary: 'Local FS Remote is healthy. Cloudflare tunnel connector is unavailable.',
      };
    }

    const externalHealthy = await this.probe.externalHealth();
    if (!externalHealthy) {
      return {
        agent: 'FS Engineering Remote v2',
        version: SERVICE_VERSION,
        environment: 'validation / development',
        endpoint: this.config.diagnosticsExternalBaseUrl,
        server: 'healthy' as const,
        server_process: 'running' as const,
        health_endpoint: '/healthz',
        port: this.config.port,
        cloudflared: 'running' as const,
        tunnel: 'down' as const,
        external_endpoint: 'unavailable' as const,
        openapi: 'unknown' as const,
        actions_auth: 'unknown' as const,
        summary: 'Local FS Remote is healthy. Cloudflare tunnel connector is unavailable.',
      };
    }

    const [openapi, actionsAuth] = await Promise.all([
      this.probe.openApiAvailable(),
      this.probe.actionsAuthAvailable(),
    ]);
    const apiHealthy = openapi && actionsAuth;
    return {
      agent: 'FS Engineering Remote v2',
      version: SERVICE_VERSION,
      environment: 'validation / development',
      endpoint: this.config.diagnosticsExternalBaseUrl,
      server: 'healthy' as const,
      server_process: 'running' as const,
      health_endpoint: '/healthz',
      port: this.config.port,
      cloudflared: 'running' as const,
      tunnel: 'connected' as const,
      external_endpoint: 'healthy' as const,
      openapi: openapi ? 'available' as const : 'unavailable' as const,
      actions_auth: actionsAuth ? 'available' as const : 'unavailable' as const,
      summary: apiHealthy
        ? 'FS Remote runtime chain is healthy.'
        : 'Transport is available but API/authentication layer requires investigation.',
    };
  }
}

