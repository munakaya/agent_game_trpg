import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.join(__dirname, '..', '..', '..');
const SKILLS_DIR = path.join(ROOT_DIR, 'agent_skills');
const SKILL_SUFFIX = '.SKILL.md';
const SKILL_FORMAT = 'skill-md/v1';

type FrontmatterValue = string | number | boolean | string[];

interface FrontmatterMap {
  [key: string]: FrontmatterValue | undefined;
}

interface AgentSkillRecord {
  format: 'skill-md/v1';
  id: string;
  title: string;
  summary: string;
  version: string;
  targets: string[];
  tags: string[];
  content: string;
  sourceFile: string;
  updatedAt: number;
}

export interface AgentSkillView {
  format: 'skill-md/v1';
  id: string;
  title: string;
  summary: string;
  version: string;
  targets: string[];
  tags: string[];
  sourceFile: string;
  updatedAt: number;
  content?: string;
}

export interface SkillQueryOptions {
  target?: string;
  includeContent?: boolean;
}

let cacheSignature = '';
let cacheSkills: AgentSkillRecord[] = [];

function normalizeNewline(raw: string): string {
  return raw.replace(/\r\n/g, '\n');
}

function stripQuotes(raw: string): string {
  const value = raw.trim();
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith('\'') && value.endsWith('\''))) {
    return value.slice(1, -1).trim();
  }
  return value;
}

function parseValue(raw: string): FrontmatterValue {
  const value = raw.trim();
  if (value.startsWith('[') && value.endsWith(']')) {
    const inner = value.slice(1, -1).trim();
    if (!inner) return [];
    return inner
      .split(',')
      .map(v => stripQuotes(v))
      .map(v => v.trim())
      .filter(Boolean);
  }

  const unquoted = stripQuotes(value);
  if (unquoted === 'true') return true;
  if (unquoted === 'false') return false;
  if (/^-?\d+(\.\d+)?$/.test(unquoted)) return Number(unquoted);
  return unquoted;
}

function parseFrontmatter(block: string): FrontmatterMap {
  const out: FrontmatterMap = {};

  for (const lineRaw of block.split('\n')) {
    const line = lineRaw.trim();
    if (!line || line.startsWith('#')) continue;

    const idx = line.indexOf(':');
    if (idx <= 0) continue;

    const key = line.slice(0, idx).trim();
    const value = line.slice(idx + 1).trim();
    out[key] = parseValue(value);
  }

  return out;
}

function parseFrontmatterAndContent(raw: string): { frontmatter: FrontmatterMap; content: string } {
  const normalized = normalizeNewline(raw);
  if (!normalized.startsWith('---\n')) {
    return { frontmatter: {}, content: normalized.trim() };
  }

  const end = normalized.indexOf('\n---\n', 4);
  if (end < 0) {
    return { frontmatter: {}, content: normalized.trim() };
  }

  const frontmatterBlock = normalized.slice(4, end);
  const content = normalized.slice(end + 5).trim();
  return { frontmatter: parseFrontmatter(frontmatterBlock), content };
}

function asString(value: FrontmatterValue | undefined, fallback = ''): string {
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number') return String(value);
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  return fallback;
}

function asStringList(value: FrontmatterValue | undefined): string[] {
  if (Array.isArray(value)) {
    return value.map(v => String(v).trim()).filter(Boolean);
  }
  if (typeof value === 'string') {
    if (value.includes(',')) {
      return value.split(',').map(v => v.trim()).filter(Boolean);
    }
    const single = value.trim();
    return single ? [single] : [];
  }
  return [];
}

function normalizeList(values: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of values) {
    const value = raw.trim().toLowerCase();
    if (!value || seen.has(value)) continue;
    seen.add(value);
    out.push(value);
  }
  return out;
}

function defaultSummary(content: string): string {
  const lines = content
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean)
    .filter(line => !line.startsWith('#'));

  const first = lines[0] || 'Skill instructions';
  if (first.length <= 120) return first;
  return `${first.slice(0, 117)}...`;
}

function parseSkillFile(raw: string, fileName: string, updatedAt: number): AgentSkillRecord {
  const { frontmatter, content } = parseFrontmatterAndContent(raw);
  const format = asString(frontmatter.format, SKILL_FORMAT);
  if (format !== SKILL_FORMAT) {
    throw new Error(`unsupported format "${format}"`);
  }

  const id = asString(frontmatter.id, fileName.replace(SKILL_SUFFIX, ''));
  if (!id) {
    throw new Error('skill id is empty');
  }

  const title = asString(frontmatter.title, id);
  const summary = asString(frontmatter.summary, defaultSummary(content));
  const version = asString(frontmatter.version, '1');

  const targets = normalizeList(asStringList(frontmatter.targets ?? frontmatter.target));
  if (targets.length === 0) targets.push('llm');

  const tags = normalizeList(asStringList(frontmatter.tags));

  return {
    format: SKILL_FORMAT,
    id,
    title,
    summary,
    version,
    targets,
    tags,
    content,
    sourceFile: `agent_skills/${fileName}`,
    updatedAt,
  };
}

function computeSignature(files: string[]): string {
  const stats = files.map((file) => {
    const st = fs.statSync(path.join(SKILLS_DIR, file));
    return `${file}:${st.mtimeMs}:${st.size}`;
  });
  return stats.join('|');
}

function loadSkillsFromDisk(): AgentSkillRecord[] {
  if (!fs.existsSync(SKILLS_DIR)) {
    cacheSignature = '';
    cacheSkills = [];
    return cacheSkills;
  }

  const files = fs.readdirSync(SKILLS_DIR)
    .filter(file => file.endsWith(SKILL_SUFFIX))
    .sort();

  const signature = computeSignature(files);
  if (signature === cacheSignature) {
    return cacheSkills;
  }

  const nextSkills: AgentSkillRecord[] = [];
  for (const file of files) {
    const fullPath = path.join(SKILLS_DIR, file);
    const raw = fs.readFileSync(fullPath, 'utf-8');
    const updatedAt = fs.statSync(fullPath).mtimeMs;
    try {
      nextSkills.push(parseSkillFile(raw, file, updatedAt));
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'unknown error';
      console.error(`[Skills] skipped invalid skill file ${file}: ${msg}`);
    }
  }

  cacheSignature = signature;
  cacheSkills = nextSkills;
  return cacheSkills;
}

function toView(skill: AgentSkillRecord, includeContent: boolean): AgentSkillView {
  return {
    format: skill.format,
    id: skill.id,
    title: skill.title,
    summary: skill.summary,
    version: skill.version,
    targets: skill.targets,
    tags: skill.tags,
    sourceFile: skill.sourceFile,
    updatedAt: skill.updatedAt,
    ...(includeContent ? { content: skill.content } : {}),
  };
}

export function listAgentSkills(options: SkillQueryOptions = {}): AgentSkillView[] {
  const target = options.target?.trim().toLowerCase();
  const includeContent = !!options.includeContent;

  const all = loadSkillsFromDisk();
  const filtered = target ? all.filter(skill => skill.targets.includes(target)) : all;
  return filtered.map(skill => toView(skill, includeContent));
}

export function getAgentSkill(skillId: string, options: SkillQueryOptions = {}): AgentSkillView | undefined {
  const includeContent = !!options.includeContent;
  const all = loadSkillsFromDisk();
  const found = all.find(skill => skill.id === skillId);
  if (!found) return undefined;

  if (options.target) {
    const target = options.target.trim().toLowerCase();
    if (!found.targets.includes(target)) return undefined;
  }

  return toView(found, includeContent);
}

export function listLlmSkillPayload(): Array<{
  id: string;
  title: string;
  summary: string;
  tags: string[];
  content: string;
}> {
  const skills = listAgentSkills({ target: 'llm', includeContent: true });
  return skills.map(skill => ({
    id: skill.id,
    title: skill.title,
    summary: skill.summary,
    tags: skill.tags,
    content: skill.content || '',
  }));
}

