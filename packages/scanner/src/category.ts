import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

const FRONTMATTER_REGEX = /^---\s*\n([\s\S]*?)\n---/;

export const CATEGORY_TAXONOMY = [
  'Marketing & Growth',
  'Creative & Design',
  'Engineering',
  'Productivity',
  'Enterprise & Communication',
  'Data & Research',
  'Visualization',
  'Tools',
  'Meta',
  'General',
] as const;

export type SkillCategory = (typeof CATEGORY_TAXONOMY)[number];

export interface SkillFrontmatter {
  name?: string;
  description?: string;
  category?: string;
  [key: string]: unknown;
}

export interface ResolveCategoryInput {
  skillDir: string;
  fallback?: string;
}

export interface ResolveCategoryResult {
  category: SkillCategory | null;
  raw?: string;
  source: 'frontmatter' | 'heuristic' | 'unknown';
}

export interface SkillFrontmatterSummary {
  category: SkillCategory | null;
  description: string | null;
}

export async function readSkillFrontmatter(skillDir: string): Promise<SkillFrontmatter | null> {
  const skillMarkdownPath = join(skillDir, 'SKILL.md');

  let rawContent: string;
  try {
    rawContent = await readFile(skillMarkdownPath, 'utf8');
  } catch {
    return null;
  }

  const match = FRONTMATTER_REGEX.exec(rawContent);
  if (!match) {
    return {};
  }

  return parseFrontmatterYaml(match[1] ?? '');
}

export async function resolveSkillFrontmatterSummary(
  input: ResolveCategoryInput,
): Promise<SkillFrontmatterSummary> {
  const frontmatter = await readSkillFrontmatter(input.skillDir);
  const rawCategory = typeof frontmatter?.category === 'string' ? frontmatter.category.trim() : '';
  const category = rawCategory.length > 0
    ? normalizeCategory(rawCategory)
    : guessCategoryFromText({
        name: typeof frontmatter?.name === 'string' ? frontmatter.name : undefined,
        description: typeof frontmatter?.description === 'string' ? frontmatter.description : undefined,
        fallback: input.fallback,
      });

  const rawDescription = typeof frontmatter?.description === 'string'
    ? frontmatter.description.trim()
    : '';

  return {
    category,
    description: rawDescription.length > 0 ? truncateDescription(rawDescription) : null,
  };
}

function truncateDescription(value: string): string {
  // Card view shows ~2 lines; cap so the metadata payload stays small.
  const MAX_LENGTH = 280;
  if (value.length <= MAX_LENGTH) {
    return value;
  }
  return `${value.slice(0, MAX_LENGTH - 1).trimEnd()}…`;
}

export async function resolveSkillCategory(input: ResolveCategoryInput): Promise<ResolveCategoryResult> {
  const frontmatter = await readSkillFrontmatter(input.skillDir);
  const rawCategory = typeof frontmatter?.category === 'string' ? frontmatter.category.trim() : '';

  if (rawCategory.length > 0) {
    return {
      category: normalizeCategory(rawCategory),
      raw: rawCategory,
      source: 'frontmatter',
    };
  }

  const heuristicCategory = guessCategoryFromText({
    name: typeof frontmatter?.name === 'string' ? frontmatter.name : undefined,
    description: typeof frontmatter?.description === 'string' ? frontmatter.description : undefined,
    fallback: input.fallback,
  });

  if (heuristicCategory) {
    return {
      category: heuristicCategory,
      source: 'heuristic',
    };
  }

  return { category: null, source: 'unknown' };
}

export function normalizeCategory(value: string | undefined | null): SkillCategory | null {
  if (!value) {
    return null;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  const lower = trimmed.toLowerCase();
  for (const candidate of CATEGORY_TAXONOMY) {
    if (candidate.toLowerCase() === lower) {
      return candidate;
    }
  }

  // Map common aliases / loose values onto the canonical taxonomy so the
  // category sidebar in CoChat doesn't fragment by punctuation/casing.
  const mapped = ALIAS_MAP[lower];
  if (mapped) {
    return mapped;
  }

  return 'General';
}

const ALIAS_MAP: Record<string, SkillCategory> = {
  marketing: 'Marketing & Growth',
  growth: 'Marketing & Growth',
  'marketing/growth': 'Marketing & Growth',
  seo: 'Marketing & Growth',
  copy: 'Marketing & Growth',
  copywriting: 'Marketing & Growth',
  design: 'Creative & Design',
  creative: 'Creative & Design',
  art: 'Creative & Design',
  ux: 'Creative & Design',
  ui: 'Creative & Design',
  engineering: 'Engineering',
  developer: 'Engineering',
  'developer-tools': 'Engineering',
  dev: 'Engineering',
  code: 'Engineering',
  coding: 'Engineering',
  programming: 'Engineering',
  productivity: 'Productivity',
  workflow: 'Productivity',
  automation: 'Productivity',
  enterprise: 'Enterprise & Communication',
  communication: 'Enterprise & Communication',
  business: 'Enterprise & Communication',
  email: 'Enterprise & Communication',
  data: 'Data & Research',
  research: 'Data & Research',
  analytics: 'Data & Research',
  analysis: 'Data & Research',
  visualization: 'Visualization',
  charts: 'Visualization',
  diagram: 'Visualization',
  dashboard: 'Visualization',
  tools: 'Tools',
  utility: 'Tools',
  meta: 'Meta',
  general: 'General',
};

function guessCategoryFromText(input: { name?: string; description?: string; fallback?: string }): SkillCategory | null {
  const haystack = [input.name, input.description, input.fallback]
    .filter((value): value is string => typeof value === 'string')
    .join(' ')
    .toLowerCase();

  if (!haystack) {
    return null;
  }

  if (/(seo|marketing|growth|copy|landing|ad campaign|social|outbound)/.test(haystack)) {
    return 'Marketing & Growth';
  }
  if (/(design|figma|ui|ux|brand|logo|illustration|color palette)/.test(haystack)) {
    return 'Creative & Design';
  }
  if (/(code|debug|refactor|developer|engineer|api|sdk|stack trace|build)/.test(haystack)) {
    return 'Engineering';
  }
  if (/(productivity|workflow|automation|task|todo|gtd|kanban)/.test(haystack)) {
    return 'Productivity';
  }
  if (/(slack|teams|email|salesforce|enterprise|customer support|crm)/.test(haystack)) {
    return 'Enterprise & Communication';
  }
  if (/(data|sql|spreadsheet|csv|analytics|notebook|research|paper)/.test(haystack)) {
    return 'Data & Research';
  }
  if (/(chart|graph|dashboard|plot|visualization|matplotlib|seaborn)/.test(haystack)) {
    return 'Visualization';
  }
  if (/(tool|wrapper|cli|integration helper)/.test(haystack)) {
    return 'Tools';
  }
  if (/(skill creator|skill author|meta-skill)/.test(haystack)) {
    return 'Meta';
  }

  return null;
}

// Tiny YAML subset parser sufficient for `key: value` and `key: "value"` lines
// inside SKILL.md frontmatter. The scanner already runs `skill-scanner` for
// safety analysis; we don't want to drag a full YAML dependency into this
// package just for category extraction.
function parseFrontmatterYaml(input: string): SkillFrontmatter {
  const result: SkillFrontmatter = {};
  for (const line of input.split('\n')) {
    const colonIndex = line.indexOf(':');
    if (colonIndex <= 0) {
      continue;
    }

    const key = line.slice(0, colonIndex).trim();
    if (!key || /\s/.test(key)) {
      continue;
    }

    const rawValue = line.slice(colonIndex + 1).trim();
    if (!rawValue) {
      continue;
    }

    result[key] = stripQuotes(rawValue);
  }

  return result;
}

function stripQuotes(value: string): string {
  if (
    (value.startsWith('"') && value.endsWith('"') && value.length >= 2)
    || (value.startsWith("'") && value.endsWith("'") && value.length >= 2)
  ) {
    return value.slice(1, -1);
  }
  return value;
}
