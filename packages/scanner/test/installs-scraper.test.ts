import { describe, expect, it, vi } from 'vitest';
import {
  extractInstallRecordsFromHtml,
  persistInstallCounts,
  scrapeSkillsShInstalls,
} from '../src/installs-scraper';

describe('extractInstallRecordsFromHtml', () => {
  // skills.sh embeds its data as a JSON-encoded *string* inside an RSC
  // <script>, so every double quote is rendered as \".  These fixtures
  // mirror what `curl https://skills.sh/` actually returns today.
  it('parses (source, skillId, installs) triples from the escape-encoded RSC payload', () => {
    const html = String.raw`
      <script>self.__next_f.push([1,"37:[\"$\",\"$L3f\",null,{\"initialSkills\":[
        {\"source\":\"vercel-labs/skills\",\"skillId\":\"find-skills\",\"name\":\"find-skills\",\"installs\":1361925},
        {\"source\":\"anthropics/skills\",\"skillId\":\"frontend-design\",\"name\":\"frontend-design\",\"installs\":372688}
      ]}"])</script>
    `;

    const records = extractInstallRecordsFromHtml(html);
    expect(records).toEqual([
      { slug: 'vercel-labs/skills/find-skills', installs: 1361925 },
      { slug: 'anthropics/skills/frontend-design', installs: 372688 },
    ]);
  });

  it('keeps the highest install count when the same skill appears across discovery pages', () => {
    const html = String.raw`
      {\"source\":\"vercel-labs/skills\",\"skillId\":\"seo-audit\",\"name\":\"seo-audit\",\"installs\":42}
      {\"source\":\"vercel-labs/skills\",\"skillId\":\"seo-audit\",\"name\":\"seo-audit\",\"installs\":99}
    `;

    const records = extractInstallRecordsFromHtml(html);
    expect(records).toEqual([{ slug: 'vercel-labs/skills/seo-audit', installs: 99 }]);
  });
});

describe('scrapeSkillsShInstalls', () => {
  it('aggregates installs across the configured discovery pages', async () => {
    const homepageHtml = String.raw`{\"source\":\"a/b\",\"skillId\":\"c\",\"name\":\"c\",\"installs\":10}`;
    const trendingHtml = String.raw`
      {\"source\":\"a/b\",\"skillId\":\"c\",\"name\":\"c\",\"installs\":50}
      {\"source\":\"d/e\",\"skillId\":\"f\",\"name\":\"f\",\"installs\":3}
    `;
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
    // With bounded concurrency the per-record fetches can interleave, so
    // assert on the set of bodies rather than positional order.
    const bodies = fetchImpl.mock.calls.map((call) => {
      const init = call[1] as { body?: string };
      return JSON.parse(init?.body ?? '{}');
    });
    for (const body of bodies) {
      expect(body.sql).toContain('UPDATE skills SET installs = ?');
    }
    expect(bodies.map((b) => b.params).sort()).toEqual(
      [
        [10, '2026-05-05T00:00:00.000Z', 'skills-sh:a/b/c'],
        [20, '2026-05-05T00:00:00.000Z', 'skills-sh:d/e/f'],
      ].sort(),
    );
  });

  it('runs updates in parallel up to the configured concurrency limit', async () => {
    let inFlight = 0;
    let peakInFlight = 0;
    const fetchImpl = vi.fn(async () => {
      inFlight += 1;
      peakInFlight = Math.max(peakInFlight, inFlight);
      // Yield to the event loop so other workers can spin up before this one
      // resolves — without the await, fetchImpl is effectively synchronous
      // and we couldn't observe the parallel window.
      await new Promise((resolve) => setTimeout(resolve, 0));
      inFlight -= 1;
      return new Response(
        JSON.stringify({ result: [{ meta: { changes: 1 } }] }),
        { status: 200 },
      );
    });

    const records = Array.from({ length: 12 }, (_, i) => ({
      source: 'skills-sh' as const,
      slug: `owner/repo/skill-${i}`,
      installs: i,
    }));

    await persistInstallCounts(
      { accountId: 'acc', apiToken: 'token', databaseId: 'db' },
      records,
      { fetchImpl: fetchImpl as typeof fetch, concurrency: 4 },
    );

    expect(fetchImpl).toHaveBeenCalledTimes(12);
    expect(peakInFlight).toBeGreaterThan(1);
    expect(peakInFlight).toBeLessThanOrEqual(4);
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
