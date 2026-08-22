import fs from 'node:fs/promises';
import path from 'node:path';

const repoRoot = process.cwd();
const skillsRoot = path.join(repoRoot, 'agent', 'skills');
const sources = [
  { source: 'core', directory: path.join(skillsRoot, 'core') },
  { source: 'agent', directory: path.join(skillsRoot, 'agent') },
];

function scalar(frontmatter, key) {
  const match = frontmatter.match(new RegExp(`^${key}:\\s*(.+)$`, 'mi'));
  if (!match) return undefined;
  return match[1].trim().replace(/^['"]|['"]$/g, '');
}

function metadata(markdown, fallbackName) {
  const match = markdown.match(/^---\s*\r?\n([\s\S]*?)\r?\n---\s*\r?\n/);
  const frontmatter = match?.[1] ?? '';
  const heading = markdown.match(/^#\s+(.+)$/m)?.[1]?.trim();
  return {
    name: scalar(frontmatter, 'name') ?? fallbackName,
    description: scalar(frontmatter, 'description') ?? heading ?? fallbackName,
  };
}

const skills = [];
for (const { source, directory } of sources) {
  const entries = await fs.readdir(directory, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const entrypoint = path.join(directory, entry.name, 'SKILL.md');
    try {
      const markdown = await fs.readFile(entrypoint, 'utf8');
      const info = metadata(markdown, entry.name);
      skills.push({
        id: `${source}:${entry.name}`,
        name: info.name,
        description: info.description,
        source,
        entrypoint: `${source}/${entry.name}/SKILL.md`,
      });
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
    }
  }
}

skills.sort((a, b) => a.id.localeCompare(b.id));
const registry = {
  version: 1,
  generatedAt: new Date().toISOString(),
  skills,
};
await fs.writeFile(
  path.join(skillsRoot, 'registry.json'),
  `${JSON.stringify(registry, null, 2)}\n`,
  'utf8',
);
console.log(`Indexed ${skills.length} skills (${skills.filter((s) => s.source === 'core').length} core, ${skills.filter((s) => s.source === 'agent').length} agent).`);
