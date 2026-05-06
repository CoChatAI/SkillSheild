import { CLAWHUB_REGISTRY_URL } from '@skillshield/shared';
import { join } from 'node:path';
import {
  downloadResponseToFile,
  execFileAsync,
  fetchJson,
  makeTempDir,
  type FetchLike,
} from '../utils';

export interface ClawHubSkillListItem {
  slug: string;
  name: string;
  latestVersion?: string;
  description?: string;
  author?: string;
  installs?: number;
  ownerHandle?: string;
}

/**
 * Response shape from /api/v1/packages?family=skill
 * This is the working listing endpoint — /api/v1/skills currently returns empty.
 */
interface PackageCatalogEntry {
  name?: unknown;
  displayName?: unknown;
  summary?: unknown;
  ownerHandle?: unknown;
  latestVersion?: unknown;
  family?: unknown;
  updatedAt?: unknown;
}

interface PackageCatalogResponse {
  items?: PackageCatalogEntry[];
  nextCursor?: unknown;
}

/**
 * Response shape from /api/v1/skills (legacy — may return empty)
 * Kept as fallback.
 */
interface SkillsListEntry {
  slug?: unknown;
  name?: unknown;
  displayName?: unknown;
  summary?: unknown;
  versions?: { latest?: unknown };
  tags?: Record<string, string>;
  stats?: { downloads?: number; installsAllTime?: number; stars?: number };
}

interface SkillsListResponse {
  skills?: SkillsListEntry[];
  items?: SkillsListEntry[];
  nextCursor?: unknown;
}

interface RateLimitState {
  remaining: number | null;
  resetAt: number | null;
}

interface ClawHubAdapterOptions {
  registry?: string;
  fetch?: FetchLike;
  sleep?: (milliseconds: number) => Promise<void>;
  extractZip?: (zipPath: string, destinationDir: string) => Promise<void>;
  maxRetries?: number;
  apiToken?: string;
}

export class ClawHubAdapter {
  readonly source = 'clawhub';

  private readonly registry: string;
  private readonly fetchImpl: FetchLike;
  private readonly sleep: (milliseconds: number) => Promise<void>;
  private readonly extractZip: (zipPath: string, destinationDir: string) => Promise<void>;
  private readonly maxRetries: number;
  private readonly apiToken: string | undefined;

  constructor(options: ClawHubAdapterOptions = {}) {
    this.registry = stripTrailingSlash(options.registry ?? CLAWHUB_REGISTRY_URL);
    this.fetchImpl = options.fetch ?? fetch;
    this.sleep = options.sleep ?? defaultSleep;
    this.extractZip = options.extractZip ?? unzipArchive;
    this.maxRetries = options.maxRetries ?? 5;
    this.apiToken = options.apiToken ?? process.env.CLAWHUB_API_TOKEN;

    if (this.apiToken) {
      console.log('[clawhub] Authenticated — using higher rate limits (180 downloads/min)');
    } else {
      console.log('[clawhub] Anonymous — rate limited to 30 downloads/min. Set CLAWHUB_API_TOKEN for 6x faster scrapes.');
    }
  }

  private buildAuthHeaders(): Record<string, string> {
    if (!this.apiToken) return {};
    return { Authorization: `Bearer ${this.apiToken}` };
  }

  /**
   * List ClawHub skills using the packages catalog endpoint.
   * Falls back to /api/v1/skills if the packages endpoint fails.
   * Pass maxSkills to stop pagination early (e.g. for bounded scrapes).
   */
  async listAll(maxSkills?: number): Promise<ClawHubSkillListItem[]> {
    const skills = await this.listViaPackages(maxSkills);

    if (skills.length > 0) {
      return skills;
    }

    // Fallback to the legacy skills endpoint
    return this.listViaSkills(maxSkills);
  }

  /**
   * Primary listing path: /api/v1/packages?family=skill
   * This endpoint works when /api/v1/skills returns empty.
   */
  private async listViaPackages(maxSkills?: number): Promise<ClawHubSkillListItem[]> {
    const skills: ClawHubSkillListItem[] = [];
    let nextCursor: string | undefined;

    while (true) {
      const pageUrl = new URL(`${this.registry}/api/v1/packages`);
      pageUrl.searchParams.set('family', 'skill');
      pageUrl.searchParams.set('limit', '200');

      if (nextCursor) {
        pageUrl.searchParams.set('cursor', nextCursor);
      }

      const payload = await fetchJson<PackageCatalogResponse>(this.fetchImpl, pageUrl.toString(), { headers: this.buildAuthHeaders() });
      const pageSkills = normalizePackageCatalogPage(payload, pageUrl.toString());

      // Cache owner handles for GitHub archive lookups during fetch()
      for (const skill of pageSkills) {
        if (skill.ownerHandle) {
          this.cacheOwnerHandle(skill.slug, skill.ownerHandle);
        }
      }

      skills.push(...pageSkills);

      if (maxSkills && skills.length >= maxSkills) {
        return skills.slice(0, maxSkills);
      }

      nextCursor = normalizeCursor(payload.nextCursor);
      if (!nextCursor) {
        return skills;
      }

      // Respect rate limits — 180 reads/min anonymous
      await this.sleep(500);
    }
  }

  /**
   * Fallback listing path: /api/v1/skills
   * Uses ?sort=updated for best coverage.
   */
  private async listViaSkills(maxSkills?: number): Promise<ClawHubSkillListItem[]> {
    const skills: ClawHubSkillListItem[] = [];
    let nextCursor: string | undefined;

    while (true) {
      const pageUrl = new URL(`${this.registry}/api/v1/skills`);
      pageUrl.searchParams.set('limit', '200');
      pageUrl.searchParams.set('sort', 'updated');

      if (nextCursor) {
        pageUrl.searchParams.set('cursor', nextCursor);
      }

      const payload = await fetchJson<SkillsListResponse>(this.fetchImpl, pageUrl.toString(), { headers: this.buildAuthHeaders() });
      const pageSkills = normalizeSkillsListPage(payload, pageUrl.toString());
      skills.push(...pageSkills);

      if (maxSkills && skills.length >= maxSkills) {
        return skills.slice(0, maxSkills);
      }

      nextCursor = normalizeCursor(payload.nextCursor);
      if (!nextCursor) {
        return skills;
      }

      await this.sleep(500);
    }
  }

  /**
   * Fetch skill content from the openclaw/skills GitHub archive.
   * This is orders of magnitude faster than the ClawHub download API
   * because raw.githubusercontent.com has no meaningful rate limit.
   *
   * Falls back to the ClawHub download API if the GitHub archive doesn't
   * have the skill (e.g. very recently published).
   */
  async fetch(slug: string, _version?: string): Promise<string> {
    if (!slug) {
      throw new Error('ClawHub fetch requires a non-empty slug.');
    }

    // Look up the owner handle from our listing cache
    const ownerHandle = this.ownerHandleCache.get(slug);

    // Try GitHub archive first if we know the owner
    if (ownerHandle) {
      const dir = await this.fetchFromGitHubArchive(ownerHandle, slug);
      if (dir) {
        return dir;
      }
    }

    // Fallback: download ZIP from ClawHub API (rate limited)
    console.log(`[clawhub] GitHub archive miss for ${slug}, falling back to ClawHub download API`);
    return this.fetchFromClawHubApi(slug, _version);
  }

  /**
   * Cache owner handles from listing results so fetch() can find skills
   * in the GitHub archive without an extra API call.
   */
  private ownerHandleCache = new Map<string, string>();

  cacheOwnerHandle(slug: string, ownerHandle: string) {
    this.ownerHandleCache.set(slug, ownerHandle);
  }

  /**
   * Fetch skill files from the openclaw/skills GitHub archive.
   * Uses raw.githubusercontent.com which has no meaningful rate limit.
   */
  private async fetchFromGitHubArchive(ownerHandle: string, slug: string): Promise<string | null> {
    const baseRawUrl = `https://raw.githubusercontent.com/openclaw/skills/main/skills/${ownerHandle}/${slug}`;

    // Check if SKILL.md exists in the archive
    const skillMdResponse = await this.fetchImpl(`${baseRawUrl}/SKILL.md`);
    if (!skillMdResponse.ok) {
      return null;
    }

    const destinationDir = await makeTempDir(`clawhub-${slug}`);

    // Write SKILL.md
    const skillMdContent = await skillMdResponse.text();
    const { writeFile } = await import('node:fs/promises');
    await writeFile(join(destinationDir, 'SKILL.md'), skillMdContent);

    // Try to fetch _meta.json for additional context
    const metaResponse = await this.fetchImpl(`${baseRawUrl}/_meta.json`);
    if (metaResponse.ok) {
      await writeFile(join(destinationDir, '_meta.json'), await metaResponse.text());
    }

    // Fetch file listing from GitHub API to get supporting files
    const contentsUrl = `https://api.github.com/repos/openclaw/skills/contents/skills/${ownerHandle}/${slug}`;
    try {
      const contentsResponse = await this.fetchImpl(contentsUrl);
      if (contentsResponse.ok) {
        const files = (await contentsResponse.json()) as Array<{ name: string; type: string; download_url: string | null }>;
        for (const file of files) {
          if (file.type !== 'file' || file.name === 'SKILL.md' || file.name === '_meta.json') {
            continue;
          }
          if (!file.download_url) {
            continue;
          }

          const fileResponse = await this.fetchImpl(file.download_url);
          if (fileResponse.ok) {
            const content = await fileResponse.arrayBuffer();
            await writeFile(join(destinationDir, file.name), new Uint8Array(content));
          }

          // Small courtesy delay between file fetches
          await this.sleep(50);
        }
      }
    } catch {
      // Non-fatal — we have SKILL.md which is enough for scanning
    }

    return destinationDir;
  }

  /**
   * Fallback: download ZIP from the ClawHub API with rate limit handling.
   */
  private async fetchFromClawHubApi(slug: string, version?: string): Promise<string> {
    const downloadUrl = new URL(`${this.registry}/api/v1/download`);
    downloadUrl.searchParams.set('slug', slug);

    if (version) {
      downloadUrl.searchParams.set('version', version);
    }

    const destinationDir = await makeTempDir(`clawhub-${slug}`);
    const archivePath = join(destinationDir, `${slugToFileName(slug)}.zip`);

    const response = await this.fetchWithRateLimitRetry(downloadUrl.toString());

    await downloadResponseToFile(response, archivePath);
    await this.extractZip(archivePath, destinationDir);

    return destinationDir;
  }

  /**
   * Fetch with rate limit awareness for ClawHub API fallback.
   */
  private async fetchWithRateLimitRetry(url: string): Promise<Response> {
    const headers = this.buildAuthHeaders();

    for (let attempt = 0; attempt < this.maxRetries; attempt++) {
      const response = await this.fetchImpl(url, { headers });
      const rateState = parseRateLimitHeaders(response.headers);

      if (response.status === 429) {
        const waitMs = computeRateLimitWait(rateState);
        console.log(`[clawhub] Rate limited (attempt ${attempt + 1}/${this.maxRetries}), waiting ${Math.round(waitMs / 1000)}s...`);
        await this.sleep(waitMs);
        continue;
      }

      await this.sleep(500);
      return response;
    }

    return this.fetchImpl(url, { headers });
  }
}

function normalizePackageCatalogPage(payload: PackageCatalogResponse, requestUrl: string): ClawHubSkillListItem[] {
  if (!payload || typeof payload !== 'object') {
    throw new Error(`ClawHub returned an invalid packages response for ${requestUrl}.`);
  }

  if (!Array.isArray(payload.items)) {
    return [];
  }

  return payload.items
    .filter((entry): entry is PackageCatalogEntry => {
      return entry !== null && typeof entry === 'object' && typeof entry.name === 'string' && entry.name.length > 0;
    })
    .map((entry) => ({
      slug: String(entry.name),
      name: typeof entry.displayName === 'string' ? entry.displayName : String(entry.name),
      latestVersion: typeof entry.latestVersion === 'string' ? entry.latestVersion : undefined,
      description: typeof entry.summary === 'string' ? entry.summary : undefined,
      author: typeof entry.ownerHandle === 'string' ? entry.ownerHandle : undefined,
      ownerHandle: typeof entry.ownerHandle === 'string' ? entry.ownerHandle : undefined,
    }));
}

function normalizeSkillsListPage(payload: SkillsListResponse, requestUrl: string): ClawHubSkillListItem[] {
  if (!payload || typeof payload !== 'object') {
    throw new Error(`ClawHub returned an invalid list response for ${requestUrl}.`);
  }

  const entries = payload.skills ?? payload.items;
  if (!Array.isArray(entries)) {
    return [];
  }

  return entries
    .filter((entry): entry is SkillsListEntry => {
      const slug = entry?.slug ?? entry?.name;
      return typeof slug === 'string' && slug.length > 0;
    })
    .map((entry) => {
      const slug = String(entry.slug ?? entry.name);
      const name = typeof entry.displayName === 'string'
        ? entry.displayName
        : typeof entry.name === 'string'
          ? entry.name
          : slug;

      const latestVersion = typeof entry.tags?.latest === 'string'
        ? entry.tags.latest
        : typeof entry.versions?.latest === 'string'
          ? String(entry.versions.latest)
          : undefined;

      return {
        slug,
        name,
        latestVersion,
        description: typeof entry.summary === 'string' ? entry.summary : undefined,
        installs: entry.stats?.installsAllTime ?? entry.stats?.downloads,
      };
    });
}

function normalizeCursor(cursor: unknown) {
  if (typeof cursor !== 'string' || cursor.length === 0) {
    return undefined;
  }

  return cursor;
}

function stripTrailingSlash(value: string) {
  return value.replace(/\/+$/, '');
}

function slugToFileName(slug: string) {
  return slug.replace(/[^a-z0-9-]/gi, '-');
}

function defaultSleep(milliseconds: number) {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}

async function unzipArchive(zipPath: string, destinationDir: string) {
  await execFileAsync('unzip', ['-o', zipPath, '-d', destinationDir]);
}

/**
 * Parse rate limit headers from ClawHub responses.
 * ClawHub sends both x-ratelimit-* and ratelimit-* (no x- prefix).
 */
function parseRateLimitHeaders(headers: Headers): RateLimitState {
  const remaining = headers.get('ratelimit-remaining') ?? headers.get('x-ratelimit-remaining');
  const reset = headers.get('ratelimit-reset') ?? headers.get('x-ratelimit-reset');

  return {
    remaining: remaining !== null ? Number.parseInt(remaining, 10) : null,
    resetAt: reset !== null ? Number.parseInt(reset, 10) : null,
  };
}

/**
 * Compute how long to wait based on rate limit state.
 * Uses the reset timestamp if available, otherwise a safe default.
 */
function computeRateLimitWait(state: RateLimitState): number {
  if (state.resetAt !== null) {
    const nowSec = Math.floor(Date.now() / 1000);
    const waitSec = Math.max(5, state.resetAt - nowSec + 2);
    return waitSec * 1000;
  }

  // No reset header — use a safe default (65s covers a typical 1-minute window)
  return 65_000;
}
