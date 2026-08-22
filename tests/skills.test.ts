import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { SkillCatalog } from '../src/skills.js';

async function fixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'fs-remote-skills-'));
  await fs.mkdir(path.join(root, 'core', 'deep-research', 'references'), { recursive: true });
  await fs.mkdir(path.join(root, 'core', 'deep-research', 'templates'), { recursive: true });
  await fs.mkdir(path.join(root, 'agent', 'deep-research'), { recursive: true });
  await fs.mkdir(path.join(root, 'core', 'frontend-design-direction'), { recursive: true });
  await fs.writeFile(
    path.join(root, 'core', 'deep-research', 'SKILL.md'),
    '# Deep Research\n\nCore research workflow.\n',
    'utf8',
  );
  await fs.writeFile(
    path.join(root, 'core', 'deep-research', 'references', 'sources.md'),
    '# Sources\n\nUse authoritative primary sources first.\n',
    'utf8',
  );
  await fs.writeFile(
    path.join(root, 'core', 'deep-research', 'templates', 'brief.md'),
    '# Research Brief\n',
    'utf8',
  );
  await fs.writeFile(
    path.join(root, 'agent', 'deep-research', 'SKILL.md'),
    '# Deep Research Agent\n\nAgent-specific research workflow.\n',
    'utf8',
  );
  await fs.writeFile(
    path.join(root, 'core', 'frontend-design-direction', 'SKILL.md'),
    '# Frontend Design Direction\n\nUI and UX design guidance.\n',
    'utf8',
  );
  const registry = {
    version: 1,
    generatedAt: '2026-08-22T00:00:00.000Z',
    skills: [
      {
        id: 'core:deep-research',
        name: 'deep-research',
        description: 'Multi-source research with evidence.',
        source: 'core',
        entrypoint: 'core/deep-research/SKILL.md',
      },
      {
        id: 'agent:deep-research',
        name: 'deep-research',
        description: 'Agent execution variant for deep research.',
        source: 'agent',
        entrypoint: 'agent/deep-research/SKILL.md',
      },
      {
        id: 'core:frontend-design-direction',
        name: 'frontend-design-direction',
        description: 'UI UX design direction for frontend work.',
        source: 'core',
        entrypoint: 'core/frontend-design-direction/SKILL.md',
      },
    ],
  };
  await fs.writeFile(path.join(root, 'registry.json'), JSON.stringify(registry), 'utf8');
  return { root, catalog: new SkillCatalog(root) };
}

test('SkillCatalog keeps duplicate names distinct by namespaced id and reports source counts', async () => {
  const { catalog } = await fixture();
  const stats = await catalog.stats();
  assert.deepEqual(stats, { total: 3, core: 2, agent: 1 });
  const all = await catalog.list();
  assert.deepEqual(all.map((skill) => skill.id), [
    'agent:deep-research',
    'core:deep-research',
    'core:frontend-design-direction',
  ]);
});

test('SkillCatalog searches names and descriptions and supports source filtering', async () => {
  const { catalog } = await fixture();
  const research = await catalog.list('research');
  assert.equal(research.length, 2);
  const design = await catalog.list('UX', 'core');
  assert.deepEqual(design.map((skill) => skill.id), ['core:frontend-design-direction']);
});

test('SkillCatalog returns skill content only for registered ids', async () => {
  const { catalog } = await fixture();
  const detail = await catalog.read('core:deep-research');
  assert.equal(detail.id, 'core:deep-research');
  assert.match(detail.content, /Core research workflow/);
  await assert.rejects(() => catalog.read('core:../secret'), /Unknown skill/i);
  await assert.rejects(() => catalog.read('missing:skill'), /Unknown skill/i);
});

test('SkillCatalog bounds list results', async () => {
  const { catalog } = await fixture();
  const limited = await catalog.list('', undefined, 1);
  assert.equal(limited.length, 1);
});

test('SkillCatalog rejects a registered entrypoint that escapes the bundled skill root', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'fs-remote-skills-escape-'));
  const outside = path.join(path.dirname(root), 'outside-skill.md');
  await fs.writeFile(outside, '# Outside\n', 'utf8');
  await fs.writeFile(path.join(root, 'registry.json'), JSON.stringify({
    version: 1,
    generatedAt: '2026-08-22T00:00:00.000Z',
    skills: [{
      id: 'core:escape',
      name: 'escape',
      description: 'malicious fixture',
      source: 'core',
      entrypoint: '../outside-skill.md',
    }],
  }), 'utf8');
  const catalog = new SkillCatalog(root);
  await assert.rejects(() => catalog.read('core:escape'), /outside the bundled skill root/i);
});


test('SkillCatalog lists governed supporting resources for a registered skill', async () => {
  const { catalog } = await fixture();
  const resources = await catalog.listResources('core:deep-research');
  assert.deepEqual(resources.map((resource) => resource.path), [
    'references/sources.md',
    'templates/brief.md',
  ]);
  assert.ok(resources.every((resource) => resource.size > 0));
});

test('SkillCatalog reads a governed supporting resource inside the registered skill directory', async () => {
  const { catalog } = await fixture();
  const resource = await catalog.readResource('core:deep-research', 'references/sources.md');
  assert.equal(resource.skillId, 'core:deep-research');
  assert.equal(resource.path, 'references/sources.md');
  assert.match(resource.content, /authoritative primary sources/i);
});

test('SkillCatalog blocks traversal, entrypoint aliasing, symlinks, and oversized resources', async () => {
  const { root, catalog } = await fixture();
  await assert.rejects(
    () => catalog.readResource('core:deep-research', '../frontend-design-direction/SKILL.md'),
    /inside the registered skill directory/i,
  );
  await assert.rejects(
    () => catalog.readResource('core:deep-research', 'SKILL.md'),
    /entrypoint/i,
  );

  const outside = path.join(path.dirname(root), `outside-${path.basename(root)}.md`);
  await fs.writeFile(outside, '# Outside resource\n', 'utf8');
  const link = path.join(root, 'core', 'deep-research', 'references', 'outside-link.md');
  try {
    await fs.symlink(outside, link);
    await assert.rejects(
      () => catalog.readResource('core:deep-research', 'references/outside-link.md'),
      /symbolic links|inside the registered skill directory/i,
    );
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EPERM') throw error;
  }

  const huge = path.join(root, 'core', 'deep-research', 'references', 'huge.md');
  await fs.writeFile(huge, 'x'.repeat(300_000), 'utf8');
  await assert.rejects(
    () => catalog.readResource('core:deep-research', 'references/huge.md'),
    /too large/i,
  );
});
