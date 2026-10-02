import path from 'node:path';
import fs from 'node:fs';

export interface RootConfig {
  name: string;
  path: string;
  workspaceId?: string;
  readOnly?: boolean;
  allowSecrets?: boolean;
}

const SECRET_NAMES = [
  '.env', '.env.local', '.env.production', '.npmrc',
  'id_rsa', 'id_ed25519', 'credentials.json', 'local.json',
  '.git-credentials', '.netrc', '_netrc', '.pypirc',
];

const SECRET_DIRECTORIES = new Set([
  '.cloudflared', '.ssh', '.aws', '.azure', '.docker',
  '.kube', '.gnupg', 'appdata',
]);

const BLOCKED_COMMANDS: Array<{ re: RegExp; label: string }> = [
  { re: /\bgit\s+remote\s+set-url\b/i, label: 'git remote set-url' },
  { re: /\bshutdown\b/i, label: 'shutdown' },
  { re: /\brestart-computer\b/i, label: 'Restart-Computer' },
  { re: /\bstop-computer\b/i, label: 'Stop-Computer' },
  { re: /\bdiskpart\b/i, label: 'diskpart' },
  { re: /\bformat(?:\.com)?\b/i, label: 'format' },
  { re: /\bbcdedit\b/i, label: 'bcdedit' },
  { re: /\bcipher\s+\/w\b/i, label: 'cipher /w' },
];

function normalizedForCompare(value: string): string {
  const normalized = path.resolve(value).replace(/[\\/]+$/, '');
  return process.platform === 'win32' ? normalized.toLowerCase() : normalized;
}

export function resolveInRoot(root: RootConfig, relativePath = '.'): string {
  if (path.isAbsolute(relativePath)) {
    throw new Error('Absolute paths are not allowed; select a configured root and use a relative path.');
  }
  const base = path.resolve(root.path);
  const candidate = path.resolve(base, relativePath);
  const baseKey = normalizedForCompare(base);
  const candidateKey = normalizedForCompare(candidate);
  const prefix = `${baseKey}${path.sep}`;
  if (candidateKey !== baseKey && !candidateKey.startsWith(prefix)) {
    throw new Error('Path resolves outside configured root.');
  }
  // A lexical path inside the root is not enough: junctions/symlinks may lead outside.
  // Explicitly configured root aliases are resolved once; links below that boundary
  // are rejected, including dangling links and links encountered on a new write path.
  if(fs.existsSync(base)){
    const canonicalBase=normalizedForCompare(fs.realpathSync.native(base));
    const relative=path.relative(base,candidate);let cursor=base;
    for(const component of relative.split(path.sep).filter(Boolean)){
      cursor=path.join(cursor,component);
      let entry:fs.Stats;
      try{entry=fs.lstatSync(cursor)}catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')break;throw error}
      if(entry.isSymbolicLink())throw new Error('Filesystem links/reparse points below a configured root are not permitted.');
      const physical=normalizedForCompare(fs.realpathSync.native(cursor));
      if(physical!==canonicalBase&&!physical.startsWith(canonicalBase+path.sep))throw new Error('Filesystem target resolves outside configured root.');
    }
  }
  return candidate;
}

export function isSensitivePath(filePath: string, rootPath?: string): boolean {
  const resolved = path.resolve(filePath);
  const scopedPath = rootPath ? path.relative(path.resolve(rootPath), resolved) : resolved;
  const parts = scopedPath.split(path.sep).filter(Boolean).map((part) => part.toLowerCase());
  const base = path.basename(resolved).toLowerCase();
  return parts.some((part) => SECRET_DIRECTORIES.has(part))
    || SECRET_NAMES.includes(base)
    || /^\.env(?:\.|$)/i.test(base)
    || /\.(pem|p12|pfx|key)$/i.test(base);
}

export function assertReadablePath(root: RootConfig, relativePath: string): string {
  const resolved = resolveInRoot(root, relativePath);
  if (!root.allowSecrets && isSensitivePath(resolved, root.path)) {
    throw new Error('Sensitive file access is blocked for this root.');
  }
  return resolved;
}

export function assertWritablePath(root: RootConfig, relativePath: string): string {
  if (root.readOnly) {
    throw new Error(`Root '${root.name}' is read-only.`);
  }
  return assertReadablePath(root, relativePath);
}

export function assertCommandAllowed(command: string): void {
  const normalized = command.replace(/\s+/g, ' ').trim();
  for (const { re, label } of BLOCKED_COMMANDS) {
    if (re.test(normalized)) {
      throw new Error(`Blocked command: ${label}`);
    }
  }
}
