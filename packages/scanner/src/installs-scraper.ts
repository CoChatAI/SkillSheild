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
  /**
   * Maximum number of D1 update requests in flight at once.  D1 doesn't
   * expose true bulk update (the HTTP query endpoint runs one statement per
   * call), so without parallelism a 700-row refresh takes ~700 sequential
   * round-trips and risks timing out the GitHub Action.  Default 8 keeps us
   * well under D1's per-account rate limits while cutting wall-clock time
   * by an order of magnitude.
   */
  concurrency?: number;
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

// skills.sh embeds its homepage data in a Next.js RSC payload as a *string*,
// which means the embedded JSON is escape-encoded inside the script tag —
// every double quote is rendered as \".  Each record looks like:
//
//   \"source\":\"vercel-labs/skills\",\"skillId\":\"find-skills\",\"name\":\"...\",\"installs\":1361925
//
// We pull out the (source, skillId, installs) triple in one regex so each
// match is self-contained — no heuristic windowing.  The full slug used by
// SkillShield's D1 row id is `${source}/${skillId}`.
//
// `[\s\S]*?` between fields keeps the tuple regex resilient to extra
// fields that skills.sh may add between source and installs without
// rewriting this scraper.
const RECORD_PATTERN =
  /\\"source\\":\\"([^"\\]+)\\"[\s\S]{0,200}?\\"skillId\\":\\"([^"\\]+)\\"[\s\S]{0,200}?\\"installs\\":(\d+)/g;

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
 * Pulls all (source, skillId, installs) triples out of a single HTML
 * document and folds them into `${source}/${skillId}` slugs.
 *
 * Slugs that appear multiple times across discovery pages keep the highest
 * install count seen — skills.sh occasionally renders the same skill on
 * the home page and on /trending with slightly different counts and the
 * larger one is the correct one.
 */
export function extractInstallRecordsFromHtml(html: string): { slug: string; installs: number }[] {
  const records = new Map<string, number>();
  RECORD_PATTERN.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = RECORD_PATTERN.exec(html)) !== null) {
    const source = match[1] ?? '';
    const skillId = match[2] ?? '';
    const installs = Number.parseInt(match[3] ?? '0', 10);
    if (!source || !skillId || !Number.isFinite(installs) || installs < 0) {
      continue;
    }
    const slug = `${source}/${skillId}`;
    if (!isSkillsShSlug(slug)) {
      continue;
    }
    const previous = records.get(slug);
    if (previous === undefined || installs > previous) {
      records.set(slug, installs);
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
  const concurrency = Math.max(1, Math.floor(options.concurrency ?? 8));
  const url = `https://api.cloudflare.com/client/v4/accounts/${config.accountId}/d1/database/${config.databaseId}/query`;
  let updated = 0;
  let cursor = 0;

  async function worker(): Promise<void> {
    while (true) {
      const index = cursor;
      cursor += 1;
      if (index >= records.length) {
        return;
      }
      const record = records[index]!;
      const changed = await updateOne(record);
      if (changed) {
        updated += 1;
      }
    }
  }

  async function updateOne(record: ScrapedInstallRecord): Promise<boolean> {
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
    return changes > 0;
  }

  await Promise.all(
    Array.from({ length: Math.min(concurrency, records.length) }, () => worker()),
  );

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
