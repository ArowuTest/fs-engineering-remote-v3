import crypto from 'node:crypto';
export type SolutionDomain='web'|'mobile'|'backend'|'desktop'|'data'|'ml'|'infrastructure'|'library'|'cli'|'embedded'|'unknown';
export type WorkShape='feature'|'bugfix'|'refactor'|'test'|'build'|'deploy'|'migration'|'research'|'review'|'maintenance'|'unknown';
export interface ExperienceContext{domain:SolutionDomain;workShape:WorkShape;languages:string[];frameworkFamilies:string[];artifactKinds:string[];environment:'local'|'sandbox'|'hosted'|'mixed'|'unknown';signals:string[]}
const norm=(xs:string[])=>[...new Set(xs.map(x=>x.trim().toLowerCase()).filter(Boolean))].sort();
export function normalizeExperience(x:Partial<ExperienceContext>={}):ExperienceContext{return{domain:x.domain??'unknown',workShape:x.workShape??'unknown',languages:norm(x.languages??[]),frameworkFamilies:norm(x.frameworkFamilies??[]),artifactKinds:norm(x.artifactKinds??[]),environment:x.environment??'unknown',signals:norm(x.signals??[])}}
export function experienceFingerprint(x:ExperienceContext){return crypto.createHash('sha256').update(JSON.stringify(normalizeExperience(x))).digest('hex')}
