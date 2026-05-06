import { SKILLS_SH_BASE_URL } from '@skillshield/shared';
import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import {
  execFileAsync,
  fetchJson,
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
  resolveRepositoryHead?: (repositoryUrl: string) => Promise<string | undefined>;
  sleep?: (milliseconds: number) => Promise<void>;
  maxRetries?: number;
}

interface SkillsPageRecord {
  pagePath: string;
  skillLinks: string[];
}

interface SkillsShApiRecord {
  source?: unknown;
  skillId?: unknown;
  name?: unknown;
}

interface SkillsShLeaderboardResponse {
  skills?: SkillsShApiRecord[];
  total?: unknown;
  hasMore?: unknown;
}

interface SkillsShSearchResponse {
  skills?: SkillsShApiRecord[];
}

export interface SkillsShSlugParts {
  owner: string;
  repo: string;
  skillName: string;
}

const DISCOVERY_PAGES = ['/', '/trending', '/hot'] as const;
const MAX_SKILL_SEARCH_DEPTH = 4;
const LEADERBOARD_PAGE_SIZE = 200;
const SEARCH_PREFIX_ALPHABET = 'abcdefghijklmnopqrstuvwxyz';
const MAX_RETRY_AFTER_MS = 120_000;

export class SkillsShAdapter {
  readonly source = 'skills-sh';

  private readonly baseUrl: string;
  private readonly fetchImpl: FetchLike;
  private readonly cloneRepository: (repositoryUrl: string, destinationDir: string, ref?: string) => Promise<void>;
  private readonly resolveRepositoryHead: (repositoryUrl: string) => Promise<string | undefined>;
  private readonly sleep: (milliseconds: number) => Promise<void>;
  private readonly maxRetries: number;
  private readonly versionCache = new Map<string, Promise<string | undefined>>();

  constructor(options: SkillsShAdapterOptions = {}) {
    this.baseUrl = stripTrailingSlash(options.baseUrl ?? SKILLS_SH_BASE_URL);
    this.fetchImpl = options.fetch ?? fetch;
    this.cloneRepository = options.cloneRepository ?? cloneGitRepository;
    this.resolveRepositoryHead = options.resolveRepositoryHead ?? resolveGitRepositoryHeadSha;
    this.sleep = options.sleep ?? defaultSleep;
    this.maxRetries = options.maxRetries ?? 4;
  }

  async resolveLatestVersion(slug: string): Promise<string | undefined> {
    const slugParts = parseSkillsShSlug(slug);
    const cacheKey = `${slugParts.owner}/${slugParts.repo}`;
    const cachedVersion = this.versionCache.get(cacheKey);
    if (cachedVersion) {
      return cachedVersion;
    }

    const repositoryUrl = buildGitHubRepositoryUrl(slugParts.owner, slugParts.repo);
    const versionPromise = this.resolveRepositoryHead(repositoryUrl);
    this.versionCache.set(cacheKey, versionPromise);

    return versionPromise;
  }

  async listAll(maxSkills?: number): Promise<SkillsShSkillListItem[]> {
    if (typeof maxSkills === 'number') {
      const leaderboardResults = await this.listViaLeaderboardApi(maxSkills);
      if (leaderboardResults.length > 0) {
        return leaderboardResults;
      }
    }

    const searchResults = await this.listViaSearchPrefixes(maxSkills);
    if (searchResults.length > 0) {
      return searchResults;
    }

    const apiResults = await this.listViaLeaderboardApi(maxSkills);
    if (apiResults.length > 0) {
      return apiResults;
    }

    return this.listViaHtmlPages(maxSkills);
  }

  private async listViaSearchPrefixes(maxSkills?: number): Promise<SkillsShSkillListItem[]> {
    const discoveredSkills = new Map<string, SkillsShSkillListItem>();

    for (const firstChar of SEARCH_PREFIX_ALPHABET) {
      for (const secondChar of SEARCH_PREFIX_ALPHABET) {
        const query = `${firstChar}${secondChar}`;
        const payload = await fetchJson<SkillsShSearchResponse>(
          this.fetchWithRetry.bind(this),
          `${this.baseUrl}/api/search?q=${encodeURIComponent(query)}&limit=100000`,
        );

        for (const skill of normalizeSearchPage(payload)) {
          if (!discoveredSkills.has(skill.slug)) {
            discoveredSkills.set(skill.slug, skill);

            if (typeof maxSkills === 'number' && discoveredSkills.size >= maxSkills) {
              return [...discoveredSkills.values()].slice(0, maxSkills);
            }
          }
        }

        await this.sleep(250);
      }
    }

    return [...discoveredSkills.values()];
  }

  private async listViaLeaderboardApi(maxSkills?: number): Promise<SkillsShSkillListItem[]> {
    const discoveredSkills = new Map<string, SkillsShSkillListItem>();
    let page = 1;

    while (true) {
      const payload = await fetchJson<SkillsShLeaderboardResponse>(
        this.fetchWithRetry.bind(this),
        `${this.baseUrl}/api/skills/all-time/${page}`,
      );

      const pageSkills = normalizeLeaderboardPage(payload);
      if (pageSkills.length === 0) {
        return [...discoveredSkills.values()];
      }

      for (const skill of pageSkills) {
        if (discoveredSkills.has(skill.slug)) {
          continue;
        }

        discoveredSkills.set(skill.slug, skill);

        if (typeof maxSkills === 'number' && discoveredSkills.size >= maxSkills) {
          return [...discoveredSkills.values()].slice(0, maxSkills);
        }
      }

      if (payload.hasMore !== true) {
        return [...discoveredSkills.values()];
      }

      page += 1;
      await this.sleep(500);
    }
  }

  private async fetchWithRetry(input: URL | RequestInfo, init?: RequestInit) {
    for (let attempt = 0; attempt < this.maxRetries; attempt++) {
      const response = await this.fetchImpl(input, init);
      if (response.status !== 429) {
        return response;
      }

      const waitMs = getRetryDelayMs(response.headers, attempt);
      await this.sleep(waitMs);
    }

    return this.fetchImpl(input, init);
  }

  private async listViaHtmlPages(maxSkills?: number): Promise<SkillsShSkillListItem[]> {
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

        if (typeof maxSkills === 'number' && discoveredSkills.size >= maxSkills) {
          return [...discoveredSkills.values()].slice(0, maxSkills);
        }
      }
    }

    return [...discoveredSkills.values()];
  }

  async fetch(slug: string, version?: string): Promise<string> {
    const slugParts = parseSkillsShSlug(slug);
    const repositoryUrl = buildGitHubRepositoryUrl(slugParts.owner, slugParts.repo);
    const repositoryDir = await makeTempDir(`skills-sh-${slugParts.owner}-${slugParts.repo}`);
    const ref = version === 'latest' ? undefined : version;

    await this.cloneRepository(repositoryUrl, repositoryDir, ref);

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
  const skillNameMatches = matchedDirectories.filter((directory) => directoryNameEquals(directory, skillName));

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

function normalizeLeaderboardPage(payload: SkillsShLeaderboardResponse): SkillsShSkillListItem[] {
  if (!Array.isArray(payload.skills)) {
    return [];
  }

  return payload.skills.flatMap((record) => {
    if (typeof record.source !== 'string' || typeof record.skillId !== 'string') {
      return [];
    }

    const sourceParts = record.source.split('/').filter(Boolean);
    if (sourceParts.length !== 2) {
      return [];
    }

    const slug = `${sourceParts[0]}/${sourceParts[1]}/${record.skillId}`;
    return [{
      slug,
      name: typeof record.name === 'string' && record.name.length > 0 ? record.name : record.skillId,
    }];
  });
}

function normalizeSearchPage(payload: SkillsShSearchResponse): SkillsShSkillListItem[] {
  if (!Array.isArray(payload.skills)) {
    return [];
  }

  return payload.skills.flatMap((record) => {
    const slug = buildSlugFromApiRecord(record);
    if (!slug) {
      return [];
    }

    return [{
      slug,
      name: typeof record.name === 'string' && record.name.length > 0 ? record.name : slug.split('/').at(-1) ?? slug,
    }];
  });
}

function buildSlugFromApiRecord(record: SkillsShApiRecord) {
  if (typeof record.source !== 'string' || typeof record.skillId !== 'string') {
    return null;
  }

  const sourceParts = record.source.split('/').filter(Boolean);
  if (sourceParts.length !== 2) {
    return null;
  }

  return `${sourceParts[0]}/${sourceParts[1]}/${record.skillId}`;
}

async function fetchPageHtml(fetchImpl: FetchLike, url: string) {
  const response = await fetchImpl(url);
  if (!response.ok) {
    throw new Error(`Request failed with status ${response.status} for ${url}`);
  }

  return response.text();
}

function defaultSleep(milliseconds: number) {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}

function getRetryDelayMs(headers: Headers, attempt: number) {
  const retryAfterHeader = headers.get('retry-after');
  if (retryAfterHeader) {
    const parsedSeconds = Number.parseInt(retryAfterHeader, 10);
    if (Number.isFinite(parsedSeconds) && parsedSeconds > 0) {
      return Math.min(parsedSeconds * 1000, MAX_RETRY_AFTER_MS);
    }

    const parsedDate = Date.parse(retryAfterHeader);
    if (!Number.isNaN(parsedDate)) {
      return Math.min(Math.max(parsedDate - Date.now(), 1000), MAX_RETRY_AFTER_MS);
    }
  }

  return Math.min(5_000 * (attempt + 1), MAX_RETRY_AFTER_MS);
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
  if (ref && isGitCommitSha(ref)) {
    await execFileAsync('git', ['init', destinationDir], { timeout: 60_000 });
    await execFileAsync('git', ['-C', destinationDir, 'remote', 'add', 'origin', repositoryUrl], { timeout: 60_000 });
    await execFileAsync('git', ['-C', destinationDir, 'fetch', '--depth', '1', 'origin', ref], { timeout: 60_000 });
    await execFileAsync('git', ['-C', destinationDir, 'checkout', '--detach', 'FETCH_HEAD'], { timeout: 60_000 });
    return;
  }

  const args = ['clone', '--depth', '1', '--single-branch'];

  if (ref) {
    args.push('--branch', ref);
  }

  args.push(repositoryUrl, destinationDir);
  await execFileAsync('git', args, { timeout: 60_000 });
}

async function resolveGitRepositoryHeadSha(repositoryUrl: string) {
  const result = await execFileAsync('git', ['ls-remote', repositoryUrl, 'HEAD'], { timeout: 60_000 });
  const sha = String(result.stdout).trim().split(/\s+/)[0];

  return sha && isGitCommitSha(sha) ? sha : undefined;
}

function isGitCommitSha(value: string) {
  return /^[a-f0-9]{40}$/i.test(value);
}
