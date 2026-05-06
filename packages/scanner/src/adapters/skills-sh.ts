import { SKILLS_SH_BASE_URL } from '@skillshield/shared';
import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import {
  execFileAsync,
  makeTempDir,
  type FetchLike,
} from '../utils';

export interface SkillsShSkillListItem {
  slug: string;
  name: string;
  latestVersion?: string;
}

interface SkillsShAdapterOptions {
  baseUrl?: string;
  fetch?: FetchLike;
  cloneRepository?: (repositoryUrl: string, destinationDir: string, ref?: string) => Promise<void>;
}

interface SkillsPageRecord {
  pagePath: string;
  skillLinks: string[];
}

export interface SkillsShSlugParts {
  owner: string;
  repo: string;
  skillName: string;
}

const DISCOVERY_PAGES = ['/', '/trending', '/hot'] as const;
const MAX_SKILL_SEARCH_DEPTH = 4;

export class SkillsShAdapter {
  readonly source = 'skills-sh';

  private readonly baseUrl: string;
  private readonly fetchImpl: FetchLike;
  private readonly cloneRepository: (repositoryUrl: string, destinationDir: string, ref?: string) => Promise<void>;

  constructor(options: SkillsShAdapterOptions = {}) {
    this.baseUrl = stripTrailingSlash(options.baseUrl ?? SKILLS_SH_BASE_URL);
    this.fetchImpl = options.fetch ?? fetch;
    this.cloneRepository = options.cloneRepository ?? cloneGitRepository;
  }

  async listAll(): Promise<SkillsShSkillListItem[]> {
    const discoveredSkills = new Map<string, SkillsShSkillListItem>();

    for (const pagePath of DISCOVERY_PAGES) {
      const pageUrl = `${this.baseUrl}${pagePath === '/' ? '' : pagePath}`;
      const pageHtml = await fetchPageHtml(this.fetchImpl, pageUrl);
      const pageSkills = extractSkillsPageRecord(pageHtml, pagePath);

      for (const slug of pageSkills.skillLinks) {
        if (discoveredSkills.has(slug)) {
          continue;
        }

        const slugParts = parseSkillsShSlug(slug);
        discoveredSkills.set(slug, {
          slug,
          name: slugParts.skillName,
        });
      }
    }

    return [...discoveredSkills.values()];
  }

  async fetch(slug: string, version?: string): Promise<string> {
    const slugParts = parseSkillsShSlug(slug);
    const repositoryUrl = buildGitHubRepositoryUrl(slugParts.owner, slugParts.repo);
    const repositoryDir = await makeTempDir(`skills-sh-${slugParts.owner}-${slugParts.repo}`);

    await this.cloneRepository(repositoryUrl, repositoryDir, version);

    return locateSkillDirectory(repositoryDir, slugParts.skillName);
  }
}

export function extractSkillsPageRecord(html: string, pagePath: string): SkillsPageRecord {
  const uniqueSlugs = new Set<string>();
  const hrefPattern = /href\s*=\s*(["'])(.*?)\1/gi;
  let match: RegExpExecArray | null;

  while ((match = hrefPattern.exec(html)) !== null) {
    const rawHref = match[2]?.trim();
    if (!rawHref) {
      continue;
    }

    const slug = normalizeSkillHref(rawHref);
    if (!slug) {
      continue;
    }

    uniqueSlugs.add(slug);
  }

  return {
    pagePath,
    skillLinks: [...uniqueSlugs],
  };
}

export function parseSkillsShSlug(slug: string): SkillsShSlugParts {
  const normalizedSlug = slug.trim().replace(/^\/+|\/+$/g, '');
  const parts = normalizedSlug.split('/').filter(Boolean);

  if (parts.length !== 3) {
    throw new Error(`Invalid skills.sh slug: ${slug}`);
  }

  const [owner, repo, skillName] = parts as [string, string, string];
  return { owner, repo, skillName };
}

export async function locateSkillDirectory(repositoryDir: string, skillName: string): Promise<string> {
  const directCandidates = [
    join(repositoryDir, skillName),
    join(repositoryDir, 'skills', skillName),
    repositoryDir,
  ];

  for (const candidateDir of directCandidates) {
    if (await directoryContainsSkillMarkdown(candidateDir)) {
      return candidateDir;
    }
  }

  // Tree-walk fallback for repos with non-standard layouts.  Two strict
  // gates so we don't index phantom skills (skills.sh's listings sometimes
  // name a slug whose path doesn't exist at all in the repo, e.g.
  // `vercel-labs/agent-skills/vercel-react-best-practices` when the actual
  // directory is `react-best-practices`):
  //
  //  1. The candidate directory's name must match the skillName exactly
  //     (case-insensitive).  Substring matches are too loose — they let
  //     `react-best-practices` satisfy a search for `vercel-react-best-practices`.
  //  2. We never fall through to "any SKILL.md in the repo" — without an
  //     exact name match the skill is treated as missing and the scrape
  //     skips it rather than persisting a verdict for the wrong content.
  const matchedDirectories = await collectDirectoriesWithSkillMarkdown(repositoryDir, 0);
  const skillNameMatches = matchedDirectories.filter((directory) =>
    directoryNameEquals(directory, skillName),
  );

  if (skillNameMatches.length > 0) {
    return preferShallowestPath(skillNameMatches);
  }

  throw new Error(`Could not locate SKILL.md for skills.sh skill "${skillName}" in ${repositoryDir}.`);
}

function normalizeSkillHref(rawHref: string) {
  if (!rawHref.startsWith('/')) {
    return null;
  }

  const withoutQuery = rawHref.split(/[?#]/, 1)[0] ?? '';
  const normalizedPath = withoutQuery.replace(/^\/+|\/+$/g, '');
  if (!normalizedPath) {
    return null;
  }

  const parts = normalizedPath.split('/').filter(Boolean);
  if (parts.length !== 3) {
    return null;
  }

  if (parts[2] === 'dl') {
    return null;
  }

  return parts.join('/');
}

async function fetchPageHtml(fetchImpl: FetchLike, url: string) {
  const response = await fetchImpl(url);
  if (!response.ok) {
    throw new Error(`Request failed with status ${response.status} for ${url}`);
  }

  return response.text();
}

async function directoryContainsSkillMarkdown(directoryPath: string) {
  try {
    const entries = await readdir(directoryPath, { withFileTypes: true });
    return entries.some((entry) => entry.isFile() && entry.name === 'SKILL.md');
  } catch {
    return false;
  }
}

async function collectDirectoriesWithSkillMarkdown(directoryPath: string, depth: number): Promise<string[]> {
  if (depth > MAX_SKILL_SEARCH_DEPTH) {
    return [];
  }

  let entries;

  try {
    entries = await readdir(directoryPath, { withFileTypes: true });
  } catch {
    return [];
  }

  const matchedDirectories: string[] = [];
  if (entries.some((entry) => entry.isFile() && entry.name === 'SKILL.md')) {
    matchedDirectories.push(directoryPath);
  }

  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }

    if (entry.name === '.git' || entry.name === 'node_modules') {
      continue;
    }

    // Skip dot-prefixed agent config directories (`.claude`, `.cursor`,
    // `.gemini`, `.github`, `.opencode`, …).  These mirror the same skill
    // content for every supported agent and pollute name-matching with
    // duplicates that don't represent a canonical source-of-truth path.
    if (entry.name.startsWith('.')) {
      continue;
    }

    const childDirectory = join(directoryPath, entry.name);
    matchedDirectories.push(...await collectDirectoriesWithSkillMarkdown(childDirectory, depth + 1));
  }

  return matchedDirectories;
}

function directoryNameEquals(directoryPath: string, skillName: string) {
  const lastSegment = directoryPath.split('/').filter(Boolean).pop() ?? '';
  return lastSegment.toLowerCase() === skillName.toLowerCase();
}

function preferShallowestPath(paths: string[]) {
  return [...paths].sort((leftPath, rightPath) => {
    const depthDifference = countPathSegments(leftPath) - countPathSegments(rightPath);
    if (depthDifference !== 0) {
      return depthDifference;
    }

    return leftPath.localeCompare(rightPath);
  })[0] as string;
}

function countPathSegments(path: string) {
  return path.split('/').filter(Boolean).length;
}

function stripTrailingSlash(value: string) {
  return value.replace(/\/+$/, '');
}

function buildGitHubRepositoryUrl(owner: string, repo: string) {
  return `https://github.com/${owner}/${repo}.git`;
}

async function cloneGitRepository(repositoryUrl: string, destinationDir: string, ref?: string) {
  const args = ['clone', '--depth', '1', '--single-branch'];

  if (ref) {
    args.push('--branch', ref);
  }

  args.push(repositoryUrl, destinationDir);
  await execFileAsync('git', args, { timeout: 60_000 });
}
