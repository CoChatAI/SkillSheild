import { describe, expect, it, vi } from 'vitest';
import {
  extractInstallRecordsFromHtml,
  persistInstallCounts,
  scrapeSkillsShInstalls,
} from '../src/installs-scraper';

describe('extractInstallRecordsFromHtml', () => {
  it('pairs slugs with the install count that follows immediately after', () => {
    const html = `
      <script id="rsc">
        {"id":"vercel/skills/seo-audit","slug":"vercel/skills/seo-audit","installs":1353667,"name":"SEO Audit"}
        {"id":"anthropics/skills/frontend-design","slug":"anthropics/skills/frontend-design","installs":373235,"name":"Frontend Design"}
      </script>
    `;

    const records = extractInstallRecordsFromHtml(html);
    expect(records).toEqual([
      { slug: 'vercel/skills/seo-audit', installs: 1353667 },
      { slug: 'anthropics/skills/frontend-design', installs: 373235 },
    ]);
  });

  it('keeps the highest install count when the same slug appears more than once', () => {
    const html = `
      {"slug":"vercel/skills/seo-audit","installs":42}
      {"slug":"vercel/skills/seo-audit","installs":99}
    `;

    const records = extractInstallRecordsFromHtml(html);
    expect(records).toEqual([{ slug: 'vercel/skills/seo-audit', installs: 99 }]);
  });

  it('ignores slugs that do not look like skills.sh paths', () => {
    const html = `
      {"slug":"dashboard/home","installs":50}
      {"slug":"some/other-thing","installs":100}
      {"slug":"valid/owner/skill","installs":7}
    `;

    const records = extractInstallRecordsFromHtml(html);
    expect(records).toEqual([{ slug: 'valid/owner/skill', installs: 7 }]);
  });
});

describe('scrapeSkillsShInstalls', () => {
  it('aggregates installs across the configured discovery pages', async () => {
    const homepageHtml = '{"slug":"a/b/c","installs":10}';
    const trendingHtml = '{"slug":"a/b/c","installs":50}{"slug":"d/e/f","installs":3}';
    const fetchImpl = vi.fn(async (url: string) => {
      if (url.endsWith('/trending')) {
        return new Response(trendingHtml, { status: 200 });
      }
      return new Response(homepageHtml, { status: 200 });
    });

    const result = await scrapeSkillsShInstalls({
      baseUrl: 'https://skills.example',
      pagePaths: ['/', '/trending'],
      fetch: fetchImpl as unknown as typeof fetch,
    });

    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(result.records).toEqual(
      expect.arrayContaining([
        { source: 'skills-sh', slug: 'a/b/c', installs: 50 },
        { source: 'skills-sh', slug: 'd/e/f', installs: 3 },
      ]),
    );
    expect(typeof result.scrapedAt).toBe('string');
  });
});

describe('persistInstallCounts', () => {
  it('issues one D1 update per record and counts changed rows', async () => {
    const fetchImpl = vi.fn(async () => new Response(
      JSON.stringify({ result: [{ meta: { changes: 1 } }] }),
      { status: 200 },
    ));

    const result = await persistInstallCounts(
      { accountId: 'acc', apiToken: 'token', databaseId: 'db' },
      [
        { source: 'skills-sh', slug: 'a/b/c', installs: 10 },
        { source: 'skills-sh', slug: 'd/e/f', installs: 20 },
      ],
      { scrapedAt: '2026-05-05T00:00:00.000Z', fetchImpl: fetchImpl as typeof fetch },
    );

    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(result).toEqual({ attempted: 2, updated: 2, scrapedAt: '2026-05-05T00:00:00.000Z' });
    const firstCall = fetchImpl.mock.calls[0]?.[1] as { body?: string };
    const body = JSON.parse(firstCall?.body ?? '{}');
    expect(body.sql).toContain('UPDATE skills SET installs = ?');
    expect(body.params).toEqual([10, '2026-05-05T00:00:00.000Z', 'skills-sh:a/b/c']);
  });

  it('throws when D1 returns a non-2xx response', async () => {
    const fetchImpl = vi.fn(async () => new Response('boom', { status: 500 }));

    await expect(
      persistInstallCounts(
        { accountId: 'acc', apiToken: 'token', databaseId: 'db' },
        [{ source: 'skills-sh', slug: 'a/b/c', installs: 1 }],
        { fetchImpl: fetchImpl as typeof fetch },
      ),
    ).rejects.toThrow(/D1 install-count update failed/);
  });
});
