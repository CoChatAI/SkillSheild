import { SKILLS_SH_BASE_URL, type SkillSource } from '@skillshield/shared';
import type { FetchLike } from './utils';

const DEFAULT_DISCOVERY_PAGES = ['/', '/trending', '/hot'] as const;
const DEFAULT_SOURCE: SkillSource = 'skills-sh';

export interface InstallsScraperOptions {
  baseUrl?: string;
  fetch?: FetchLike;
  pagePaths?: readonly string[];
  source?: SkillSource;
}

export interface ScrapedInstallRecord {
  source: SkillSource;
  slug: string;
  installs: number;
}

export interface ScrapeInstallsResult {
  scrapedAt: string;
  records: ScrapedInstallRecord[];
}

export interface PersistInstallsOptions {
  scrapedAt?: string;
  fetchImpl?: typeof fetch;
}

export interface PersistInstallsResult {
  attempted: number;
  updated: number;
  scrapedAt: string;
}

export interface CloudflareD1Config {
  accountId: string;
  apiToken: string;
  databaseId: string;
}

// skills.sh embeds its homepage data in a Next.js RSC payload that contains
// quoted JSON-ish entries shaped roughly like:
//
//   {"slug":"vercel/skills/seo-audit","installs":1353667,"name":"...","source":"vercel/skills"}
//
// We don't get a stable structured contract, so we rely on the slug+installs
// pair appearing within a small window of each other in the HTML.  This is
// resilient to most layout shuffles and only fails if the keys are renamed.
const SLUG_PATTERN = /"slug"\s*:\s*"([^"]+)"/g;
const INSTALLS_PATTERN = /"installs"\s*:\s*(\d+)/g;
const PAIR_WINDOW = 600;

/**
 * Fetches the skills.sh homepage variants and extracts (slug, installs) pairs.
 * Slugs that appear more than once keep the highest install count seen.
 */
export async function scrapeSkillsShInstalls(
  options: InstallsScraperOptions = {},
): Promise<ScrapeInstallsResult> {
  const fetchImpl = options.fetch ?? fetch;
  const baseUrl = stripTrailingSlash(options.baseUrl ?? SKILLS_SH_BASE_URL);
  const pages = options.pagePaths && options.pagePaths.length > 0
    ? options.pagePaths
    : DEFAULT_DISCOVERY_PAGES;
  const source = options.source ?? DEFAULT_SOURCE;
  const scrapedAt = new Date().toISOString();
  const installs = new Map<string, number>();

  for (const pagePath of pages) {
    const url = `${baseUrl}${pagePath === '/' ? '' : pagePath}`;
    const html = await fetchPageHtml(fetchImpl, url);
    for (const record of extractInstallRecordsFromHtml(html)) {
      const previous = installs.get(record.slug);
      if (previous === undefined || record.installs > previous) {
        installs.set(record.slug, record.installs);
      }
    }
  }

  return {
    scrapedAt,
    records: [...installs.entries()].map(([slug, count]) => ({
      source,
      slug,
      installs: count,
    })),
  };
}

/**
 * Pulls all `slug` / `installs` pairs out of a single HTML document.  Only
 * pairs whose `installs` token follows the matching `slug` token within
 * `PAIR_WINDOW` characters are emitted, which keeps us from accidentally
 * pairing a slug with the install count of a sibling skill that happens to
 * appear later in the payload.
 */
export function extractInstallRecordsFromHtml(html: string): { slug: string; installs: number }[] {
  const slugMatches: { slug: string; index: number }[] = [];
  let slugMatch: RegExpExecArray | null;
  SLUG_PATTERN.lastIndex = 0;
  while ((slugMatch = SLUG_PATTERN.exec(html)) !== null) {
    const rawSlug = slugMatch[1] ?? '';
    if (!isSkillsShSlug(rawSlug)) {
      continue;
    }
    slugMatches.push({ slug: rawSlug, index: slugMatch.index });
  }

  const installMatches: { installs: number; index: number }[] = [];
  let installMatch: RegExpExecArray | null;
  INSTALLS_PATTERN.lastIndex = 0;
  while ((installMatch = INSTALLS_PATTERN.exec(html)) !== null) {
    const value = Number.parseInt(installMatch[1] ?? '0', 10);
    if (!Number.isFinite(value) || value < 0) {
      continue;
    }
    installMatches.push({ installs: value, index: installMatch.index });
  }

  if (slugMatches.length === 0 || installMatches.length === 0) {
    return [];
  }

  const records = new Map<string, number>();
  let installCursor = 0;

  for (const slug of slugMatches) {
    while (
      installCursor < installMatches.length
      && installMatches[installCursor]!.index < slug.index
    ) {
      installCursor += 1;
    }

    const candidate = installMatches[installCursor];
    if (!candidate) {
      break;
    }

    if (candidate.index - slug.index > PAIR_WINDOW) {
      continue;
    }

    const previous = records.get(slug.slug);
    if (previous === undefined || candidate.installs > previous) {
      records.set(slug.slug, candidate.installs);
    }
  }

  return [...records.entries()].map(([slug, installs]) => ({ slug, installs }));
}

/**
 * Bulk-applies scraped install counts to D1.  Each row is updated through the
 * Cloudflare D1 HTTP API in the publisher's existing pattern; we only update
 * rows that already exist so the scraper never invents skill rows that the
 * scanner hasn't seen yet (the scanner is the canonical source of truth for
 * verdict/security state).
 */
export async function persistInstallCounts(
  config: CloudflareD1Config,
  records: ScrapedInstallRecord[],
  options: PersistInstallsOptions = {},
): Promise<PersistInstallsResult> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const scrapedAt = options.scrapedAt ?? new Date().toISOString();
  const url = `https://api.cloudflare.com/client/v4/accounts/${config.accountId}/d1/database/${config.databaseId}/query`;
  let updated = 0;

  for (const record of records) {
    const skillId = `${record.source}:${record.slug}`;

    const response = await fetchImpl(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.apiToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        sql: 'UPDATE skills SET installs = ?, installs_updated_at = ? WHERE id = ?',
        params: [record.installs, scrapedAt, skillId],
      }),
    });

    if (!response.ok) {
      const responseBody = await response.text().catch(() => '');
      throw new Error(
        responseBody.trim().length > 0
          ? `D1 install-count update failed (${response.status}): ${responseBody.trim()}`
          : `D1 install-count update failed (${response.status}) for ${skillId}`,
      );
    }

    const result = (await response.json().catch(() => null)) as
      | { result?: Array<{ meta?: { changes?: number } }> }
      | null;
    const changes = result?.result?.[0]?.meta?.changes ?? 0;
    if (changes > 0) {
      updated += 1;
    }
  }

  return {
    attempted: records.length,
    updated,
    scrapedAt,
  };
}

function isSkillsShSlug(value: string) {
  // Valid skills.sh slugs are owner/repo/name. Filter out URL-style strings
  // and any internal RSC keys that happen to also live under a `slug` key.
  if (!value || value.includes(' ')) {
    return false;
  }
  const parts = value.split('/').filter(Boolean);
  return parts.length === 3 && parts.every((part) => part.length > 0);
}

async function fetchPageHtml(fetchImpl: FetchLike, url: string) {
  const response = await fetchImpl(url);
  if (!response.ok) {
    throw new Error(`Request failed with status ${response.status} for ${url}`);
  }
  return response.text();
}

function stripTrailingSlash(value: string) {
  return value.replace(/\/+$/, '');
}
