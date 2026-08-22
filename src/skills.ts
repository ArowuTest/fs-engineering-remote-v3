import fs from 'node:fs/promises';
import path from 'node:path';

export type SkillSource = 'core' | 'agent';

export interface SkillSummary {
  id: string;
  name: string;
  description: string;
  source: SkillSource;
  entrypoint: string;
}

export interface SkillDetail extends SkillSummary {
  content: string;
}

export interface SkillResourceSummary {
  path: string;
  size: number;
}

export interface SkillResourceDetail extends SkillResourceSummary {
  skillId: string;
  content: string;
}

export interface SkillEvaluation {
  skillId: string;
  score: number;
  verdict: 'recommended' | 'review' | 'reject';
  gates: { security: boolean; correctness: boolean; discoverability: boolean; effectiveness: boolean; efficiency: boolean };
  findings: string[];
  provenance: { source: SkillSource; entrypoint: string; bundled: true; signatureVerified: false };
}

interface SkillRegistry {
  version: number;
  generatedAt: string;
  skills: SkillSummary[];
}

const MAX_SKILL_RESOURCES = 500;
const MAX_SKILL_RESOURCE_BYTES = 256 * 1024;

function isSource(value: unknown): value is SkillSource {
  return value === 'core' || value === 'agent';
}

function validateEntry(value: unknown): SkillSummary {
  if (!value || typeof value !== 'object') throw new Error('Invalid skill registry entry.');
  const item = value as Record<string, unknown>;
  if (
    typeof item.id !== 'string'
    || typeof item.name !== 'string'
    || typeof item.description !== 'string'
    || !isSource(item.source)
    || typeof item.entrypoint !== 'string'
  ) {
    throw new Error('Invalid skill registry entry.');
  }
  return {
    id: item.id,
    name: item.name,
    description: item.description,
    source: item.source,
    entrypoint: item.entrypoint,
  };
}

function assertInside(parent: string, candidate: string, message: string): void {
  const relative = path.relative(parent, candidate);
  if (relative.startsWith('..') || path.isAbsolute(relative)) throw new Error(message);
}

function portableRelative(value: string): string {
  return value.split(path.sep).join('/');
}

export class SkillCatalog {
  private registry?: SkillRegistry;

  constructor(private readonly skillsRoot: string) {}

  private async load(): Promise<SkillRegistry> {
    if (this.registry) return this.registry;
    const raw = JSON.parse(await fs.readFile(path.join(this.skillsRoot, 'registry.json'), 'utf8')) as Record<string, unknown>;
    if (!Array.isArray(raw.skills)) throw new Error('Invalid skill registry.');
    this.registry = {
      version: typeof raw.version === 'number' ? raw.version : 1,
      generatedAt: typeof raw.generatedAt === 'string' ? raw.generatedAt : '',
      skills: raw.skills.map(validateEntry).sort((a, b) => a.id.localeCompare(b.id)),
    };
    return this.registry;
  }

  private async findSkill(id: string): Promise<SkillSummary> {
    const registry = await this.load();
    const skill = registry.skills.find((item) => item.id === id);
    if (!skill) throw new Error(`Unknown skill '${id}'. Use list_skills first.`);
    return skill;
  }

  private async skillDirectory(skill: SkillSummary): Promise<{ lexical: string; real: string; entrypoint: string }> {
    const entrypoint = path.resolve(this.skillsRoot, skill.entrypoint);
    assertInside(this.skillsRoot, entrypoint, 'Skill entrypoint is outside the bundled skill root.');
    const lexical = path.dirname(entrypoint);
    const real = await fs.realpath(lexical);
    const realRoot = await fs.realpath(this.skillsRoot);
    assertInside(realRoot, real, 'Skill directory is outside the bundled skill root.');
    return { lexical, real, entrypoint };
  }

  async stats(): Promise<{ total: number; core: number; agent: number }> {
    const registry = await this.load();
    return {
      total: registry.skills.length,
      core: registry.skills.filter((skill) => skill.source === 'core').length,
      agent: registry.skills.filter((skill) => skill.source === 'agent').length,
    };
  }

  async list(query = '', source?: SkillSource, limit = 50): Promise<SkillSummary[]> {
    const registry = await this.load();
    const needle = query.trim().toLowerCase();
    const safeLimit = Math.max(1, Math.min(limit, 200));
    return registry.skills
      .filter((skill) => !source || skill.source === source)
      .filter((skill) => {
        if (!needle) return true;
        return `${skill.id}\n${skill.name}\n${skill.description}`.toLowerCase().includes(needle);
      })
      .slice(0, safeLimit);
  }

  async read(id: string): Promise<SkillDetail> {
    const skill = await this.findSkill(id);
    const { real, entrypoint } = await this.skillDirectory(skill);
    const realEntrypoint = await fs.realpath(entrypoint);
    assertInside(real, realEntrypoint, 'Skill entrypoint is outside the registered skill directory.');
    const content = await fs.readFile(realEntrypoint, 'utf8');
    return { ...skill, content };
  }

  async evaluate(id: string): Promise<SkillEvaluation> {
    const skill = await this.read(id);
    const text = `${skill.name}\n${skill.description}\n${skill.content}`;
    const lower = text.toLowerCase();
    const findings: string[] = [];
    const security = !/(disable\s+(security|auth)|bypass\s+(auth|security)|ignore\s+(security|policy)|curl[^\n]+\|\s*(sh|bash)|invoke-expression|iex\s)/i.test(text);
    if (!security) findings.push('Potentially unsafe or policy-bypassing instruction pattern detected.');
    const correctness = /(^|\n)#{1,3}\s+|workflow|steps|procedure|when to use|use when/i.test(text) && text.trim().length >= 200;
    if (!correctness) findings.push('Skill lacks enough structured operational guidance.');
    const discoverability = skill.name.trim().length > 1 && skill.description.trim().length >= 24;
    if (!discoverability) findings.push('Skill metadata is too weak for reliable discovery.');
    const effectiveness = /verify|test|evidence|output|acceptance|result|validation|check/i.test(lower);
    if (!effectiveness) findings.push('Skill does not clearly describe verification or expected evidence/output.');
    const efficiency = text.length <= 100_000;
    if (!efficiency) findings.push('Skill entrypoint is excessively large for routine agent loading.');
    const gates={security,correctness,discoverability,effectiveness,efficiency};
    const score=Object.values(gates).filter(Boolean).length;
    const verdict:SkillEvaluation['verdict']=!security?'reject':score===5?'recommended':'review';
    return {skillId:id,score,verdict,gates,findings,provenance:{source:skill.source,entrypoint:skill.entrypoint,bundled:true,signatureVerified:false}};
  }

  async listResources(id: string): Promise<SkillResourceSummary[]> {
    const skill = await this.findSkill(id);
    const { lexical } = await this.skillDirectory(skill);
    const resources: SkillResourceSummary[] = [];

    const visit = async (directory: string): Promise<void> => {
      if (resources.length >= MAX_SKILL_RESOURCES) return;
      const entries = await fs.readdir(directory, { withFileTypes: true });
      for (const entry of entries) {
        if (resources.length >= MAX_SKILL_RESOURCES) break;
        if (entry.isSymbolicLink()) continue;
        const absolute = path.join(directory, entry.name);
        if (entry.isDirectory()) {
          await visit(absolute);
          continue;
        }
        if (!entry.isFile()) continue;
        const relative = portableRelative(path.relative(lexical, absolute));
        if (relative.toLowerCase() === 'skill.md') continue;
        const stat = await fs.stat(absolute);
        resources.push({ path: relative, size: stat.size });
      }
    };

    await visit(lexical);
    return resources.sort((a, b) => a.path.localeCompare(b.path));
  }

  async readResource(id: string, resourcePath: string): Promise<SkillResourceDetail> {
    const skill = await this.findSkill(id);
    const { lexical, real } = await this.skillDirectory(skill);
    const normalizedInput = resourcePath.trim();
    if (!normalizedInput) throw new Error('Resource path is required.');
    const candidate = path.resolve(lexical, normalizedInput);
    assertInside(lexical, candidate, 'Skill resource must stay inside the registered skill directory.');
    if (portableRelative(path.relative(lexical, candidate)).toLowerCase() === 'skill.md') {
      throw new Error('Use read_skill for the skill entrypoint.');
    }

    const lstat = await fs.lstat(candidate);
    if (lstat.isSymbolicLink()) throw new Error('Skill resource symbolic links are not allowed.');
    if (!lstat.isFile()) throw new Error('Skill resource must be a regular file.');
    if (lstat.size > MAX_SKILL_RESOURCE_BYTES) {
      throw new Error(`Skill resource is too large to read (${lstat.size} bytes; max ${MAX_SKILL_RESOURCE_BYTES}).`);
    }

    const realCandidate = await fs.realpath(candidate);
    assertInside(real, realCandidate, 'Skill resource must stay inside the registered skill directory.');
    const content = await fs.readFile(realCandidate, 'utf8');
    return {
      skillId: skill.id,
      path: portableRelative(path.relative(lexical, candidate)),
      size: lstat.size,
      content,
    };
  }
}

export function defaultSkillsRoot(): string {
  return path.resolve(process.cwd(), 'agent', 'skills');
}
