import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {
  assertCommandAllowed,
  assertReadablePath,
  resolveInRoot,
  type RootConfig,
} from '../src/security.js';

const root: RootConfig = {
  name: 'project',
  path: path.resolve('C:/work/project'),
};

test('resolveInRoot accepts a relative path inside the configured root', () => {
  const result = resolveInRoot(root, 'src/index.ts');
  assert.equal(result, path.resolve(root.path, 'src/index.ts'));
});

test('resolveInRoot rejects parent traversal outside the configured root', () => {
  assert.throws(() => resolveInRoot(root, '../secret.txt'), /outside configured root/i);
});

test('assertReadablePath blocks common secret files by default', () => {
  assert.throws(() => assertReadablePath(root, '.env'), /sensitive file/i);
});

test('assertCommandAllowed permits ordinary local build commands', () => {
  assert.doesNotThrow(() => assertCommandAllowed('npm test'));
  assert.doesNotThrow(() => assertCommandAllowed('docker compose ps'));
});

test('assertCommandAllowed permits normal Git delivery commands', () => {
  assert.doesNotThrow(() => assertCommandAllowed(['git', 'push', 'origin', 'main'].join(' ')));
  assert.doesNotThrow(() => assertCommandAllowed(['GIT', 'PUSH'].join('   ')));
});

test('assertCommandAllowed blocks high-risk Windows administration commands', () => {
  assert.throws(() => assertCommandAllowed('shutdown /s /t 0'), /blocked command/i);
  assert.throws(() => assertCommandAllowed('diskpart'), /blocked command/i);
});

const profileRoot: RootConfig = {
  name: 'fs',
  path: path.resolve('C:/Users/sanus'),
};

test('profile root blocks credential stores and environment secret variants', () => {
  const blocked = [
    '.cloudflared/tunnel-credentials.json',
    '.ssh/config',
    '.aws/credentials',
    '.docker/config.json',
    'AppData/Roaming/example/token.json',
    'Desktop/project/.env.development',
  ];
  for (const candidate of blocked) {
    assert.throws(() => assertReadablePath(profileRoot, candidate), /sensitive file/i, candidate);
  }
});

test('profile root still permits ordinary project files', () => {
  assert.doesNotThrow(() => assertReadablePath(profileRoot, 'Desktop/project/src/index.ts'));
  assert.doesNotThrow(() => assertReadablePath(profileRoot, 'Documents/project/README.md'));
});

test('sensitive directory checks are relative to the configured root', () => {
  const tempRoot: RootConfig = {
    name: 'temp-fixture',
    path: path.resolve('C:/Users/sanus/AppData/Local/Temp/fs-remote-test'),
  };
  assert.doesNotThrow(() => assertReadablePath(tempRoot, 'hello.txt'));
});