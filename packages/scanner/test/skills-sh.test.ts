import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  extractSkillsPageRecord,
  locateSkillDirectory,
  parseSkillsShSlug,
  SkillsShAdapter,
} from '../src/adapters/skills-sh';
import { makeTempDir } from '../src/utils';

describe('SkillsShAdapter', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('discovers skills from 2-letter search prefix enumeration', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (!url.includes('/api/search?')) {
        return jsonResponse({ skills: [] });
      }

      const query = new URL(url).searchParams.get('q');
      if (query === 'aa') {
        return jsonResponse({
          skills: [
            { source: 'anthropics/skills', skillId: 'frontend-design', name: 'frontend-design' },
            { source: 'vercel-labs/agent-skills', skillId: 'vercel-react-best-practices', name: 'vercel-react-best-practices' },
          ],
        });
      }

      if (query === 'ab') {
        return jsonResponse({
          skills: [
            { source: 'anthropics/skills', skillId: 'frontend-design', name: 'frontend-design' },
            { source: 'openai/skills', skillId: 'prompt-reviewer', name: 'Prompt Reviewer' },
          ],
        });
      }

      return jsonResponse({ skills: [] });
    });
    const adapter = new SkillsShAdapter({
      baseUrl: 'https://skills.example',
      fetch: fetchMock as typeof fetch,
      cloneRepository: vi.fn(),
      sleep: vi.fn(async () => {}),
    });

    const result = await adapter.listAll();

    expect(result).toEqual([
      { slug: 'anthropics/skills/frontend-design', name: 'frontend-design' },
      { slug: 'vercel-labs/agent-skills/vercel-react-best-practices', name: 'vercel-react-best-practices' },
      { slug: 'openai/skills/prompt-reviewer', name: 'Prompt Reviewer' },
    ]);
    expect(fetchMock).toHaveBeenCalledWith('https://skills.example/api/search?q=aa&limit=100000', undefined);
    expect(fetchMock).toHaveBeenCalledWith('https://skills.example/api/search?q=ab&limit=100000', undefined);
  });

  it('falls back to fixture-backed html pages when search and leaderboard discovery are empty', async () => {
    const homeHtml = await readFixture('home.html');
    const trendingHtml = `
      <a href="/anthropics/skills/frontend-design">Duplicate</a>
      <a href="/openai/skills/prompt-reviewer">Prompt Reviewer</a>
    `;
    const hotHtml = '<a href="/cochat/skills/incident-response">Incident Response</a>';
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/api/search?')) {
        return jsonResponse({ skills: [] });
      }
      if (url.includes('/api/skills/all-time/1')) {
        return jsonResponse({ skills: [], hasMore: false, total: 0 });
      }
      if (url === 'https://skills.example') {
        return htmlResponse(homeHtml);
      }
      if (url === 'https://skills.example/trending') {
        return htmlResponse(trendingHtml);
      }
      if (url === 'https://skills.example/hot') {
        return htmlResponse(hotHtml);
      }

      throw new Error(`Unexpected URL: ${url}`);
    });
    const adapter = new SkillsShAdapter({
      baseUrl: 'https://skills.example',
      fetch: fetchMock as typeof fetch,
      cloneRepository: vi.fn(),
      sleep: vi.fn(async () => {}),
    });

    const result = await adapter.listAll();

    expect(result).toEqual([
      { slug: 'anthropics/skills/frontend-design', name: 'frontend-design' },
      { slug: 'vercel-labs/agent-skills/vercel-react-best-practices', name: 'vercel-react-best-practices' },
      { slug: 'openai/skills/prompt-reviewer', name: 'prompt-reviewer' },
      { slug: 'cochat/skills/incident-response', name: 'incident-response' },
    ]);
    expect(fetchMock).toHaveBeenCalledWith('https://skills.example/api/skills/all-time/1', undefined);
    expect(fetchMock).toHaveBeenCalledWith('https://skills.example/api/search?q=aa&limit=100000', undefined);
    const requestedUrls = fetchMock.mock.calls.map((call) => String(call[0]));
    expect(requestedUrls).toContain('https://skills.example');
    expect(requestedUrls).toContain('https://skills.example/trending');
    expect(requestedUrls).toContain('https://skills.example/hot');
  });

  it('uses the leaderboard fast path and stops early when maxSkills is provided', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({
        skills: [
          { source: 'anthropics/skills', skillId: 'frontend-design', name: 'frontend-design' },
          { source: 'vercel-labs/agent-skills', skillId: 'vercel-react-best-practices', name: 'vercel-react-best-practices' },
          { source: 'openai/skills', skillId: 'prompt-reviewer', name: 'Prompt Reviewer' },
        ],
        total: 91611,
        hasMore: true,
      }));
    const adapter = new SkillsShAdapter({
      baseUrl: 'https://skills.example',
      fetch: fetchMock as typeof fetch,
      cloneRepository: vi.fn(),
      sleep: vi.fn(async () => {}),
    });

    const result = await adapter.listAll(2);

    expect(result).toEqual([
      { slug: 'anthropics/skills/frontend-design', name: 'frontend-design' },
      { slug: 'vercel-labs/agent-skills/vercel-react-best-practices', name: 'vercel-react-best-practices' },
    ]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('honors Retry-After on 429 responses with a capped wait', async () => {
    const sleep = vi.fn(async () => {});
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: 'rate_limit_exceeded' }), {
        status: 429,
        headers: { 'retry-after': '60', 'content-type': 'application/json' },
      }))
      .mockResolvedValueOnce(jsonResponse({
        skills: [
          { source: 'anthropics/skills', skillId: 'frontend-design', name: 'frontend-design' },
        ],
        total: 91611,
        hasMore: true,
      }));

    const adapter = new SkillsShAdapter({
      baseUrl: 'https://skills.example',
      fetch: fetchMock as typeof fetch,
      cloneRepository: vi.fn(),
      sleep,
    });

    const result = await adapter.listAll(1);

    expect(result).toEqual([
      { slug: 'anthropics/skills/frontend-design', name: 'frontend-design' },
    ]);
    expect(sleep).toHaveBeenCalledWith(60_000);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('resolves and caches GitHub repo HEAD SHAs for freshness', async () => {
    const resolveRepositoryHead = vi.fn(async () => '0123456789abcdef0123456789abcdef01234567');
    const adapter = new SkillsShAdapter({
      fetch: vi.fn() as typeof fetch,
      cloneRepository: vi.fn(),
      resolveRepositoryHead,
    });

    await expect(adapter.resolveLatestVersion('anthropics/skills/frontend-design')).resolves.toBe(
      '0123456789abcdef0123456789abcdef01234567',
    );
    await expect(adapter.resolveLatestVersion('anthropics/skills/other-skill')).resolves.toBe(
      '0123456789abcdef0123456789abcdef01234567',
    );

    expect(resolveRepositoryHead).toHaveBeenCalledTimes(1);
    expect(resolveRepositoryHead).toHaveBeenCalledWith('https://github.com/anthropics/skills.git');
  });

  it('passes the repo URL and requested ref into clone and returns the repo-root skill', async () => {
    const cloneRepository = vi.fn(async (_repositoryUrl: string, destinationDir: string) => {
      await writeFile(join(destinationDir, 'SKILL.md'), '# Frontend Design\n');
    });
    const adapter = new SkillsShAdapter({ cloneRepository, fetch: vi.fn() as typeof fetch });

    const skillDir = await adapter.fetch('anthropics/skills/frontend-design', 'refs/tags/v1.2.0');

    expect(cloneRepository).toHaveBeenCalledWith(
      'https://github.com/anthropics/skills.git',
      skillDir,
      'refs/tags/v1.2.0',
    );
    await expect(readFile(join(skillDir, 'SKILL.md'), 'utf8')).resolves.toContain('Frontend Design');
  });

  it('treats latest as the repository default branch when cloning', async () => {
    const cloneRepository = vi.fn(async (_repositoryUrl: string, destinationDir: string) => {
      await writeFile(join(destinationDir, 'SKILL.md'), '# Frontend Design\n');
    });
    const adapter = new SkillsShAdapter({ cloneRepository, fetch: vi.fn() as typeof fetch });

    await adapter.fetch('anthropics/skills/frontend-design', 'latest');

    expect(cloneRepository).toHaveBeenCalledWith(
      'https://github.com/anthropics/skills.git',
      expect.any(String),
      undefined,
    );
  });

  it('prefers skills/<name> when the repo contains multiple skill locations', async () => {
    const cloneRepository = vi.fn(async (_repositoryUrl: string, destinationDir: string) => {
      await mkdir(join(destinationDir, 'skills', 'frontend-design'), { recursive: true });
      await mkdir(join(destinationDir, 'skills', 'other-skill'), { recursive: true });
      await writeFile(join(destinationDir, 'skills', 'frontend-design', 'SKILL.md'), '# Frontend Design\n');
      await writeFile(join(destinationDir, 'skills', 'other-skill', 'SKILL.md'), '# Other Skill\n');
    });
    const adapter = new SkillsShAdapter({ cloneRepository, fetch: vi.fn() as typeof fetch });

    const skillDir = await adapter.fetch('anthropics/skills/frontend-design');

    expect(skillDir).toMatch(/skills\/frontend-design$/);
  });

  it('falls back to recursive SKILL.md discovery for nested repo layouts', async () => {
    const repositoryDir = await makeTempDir('skills-sh-nested-test');
    await mkdir(join(repositoryDir, 'packages', 'frontend-design'), { recursive: true });
    await mkdir(join(repositoryDir, '.git'), { recursive: true });
    await writeFile(join(repositoryDir, 'packages', 'frontend-design', 'SKILL.md'), '# Nested Skill\n');

    await expect(locateSkillDirectory(repositoryDir, 'frontend-design')).resolves.toMatch(/packages\/frontend-design$/);
  });

  it('refuses to fall back to a different skill when the slug name has no exact match', async () => {
    // skills.sh sometimes lists slugs that don't actually exist in the
    // upstream repo (e.g. `vercel-react-best-practices` when the dir is
    // `react-best-practices`).  We must NOT silently substitute another
    // skill's content — the row would mislead users.
    const repositoryDir = await makeTempDir('skills-sh-mismatch-test');
    await mkdir(join(repositoryDir, 'skills', 'react-best-practices'), { recursive: true });
    await writeFile(
      join(repositoryDir, 'skills', 'react-best-practices', 'SKILL.md'),
      '# React best practices\n',
    );

    await expect(
      locateSkillDirectory(repositoryDir, 'vercel-react-best-practices'),
    ).rejects.toThrow(/Could not locate SKILL\.md/);
  });

  it('ignores dot-prefixed agent config dirs (.claude, .cursor, …) during tree walk', async () => {
    const repositoryDir = await makeTempDir('skills-sh-dotdir-test');
    await mkdir(join(repositoryDir, '.claude', 'skills', 'impeccable'), { recursive: true });
    await mkdir(join(repositoryDir, '.cursor', 'skills', 'impeccable'), { recursive: true });
    await writeFile(
      join(repositoryDir, '.claude', 'skills', 'impeccable', 'SKILL.md'),
      '# Impeccable (claude)\n',
    );
    await writeFile(
      join(repositoryDir, '.cursor', 'skills', 'impeccable', 'SKILL.md'),
      '# Impeccable (cursor)\n',
    );

    // The repo contains SKILL.md files but only inside dot-prefixed
    // agent config dirs; the scanner should treat the slug as missing
    // rather than indexing the duplicated `impeccable` content under a
    // different slug name like `arrange`.
    await expect(
      locateSkillDirectory(repositoryDir, 'arrange'),
    ).rejects.toThrow(/Could not locate SKILL\.md/);
  });

  it('exposes small parsing helpers for slug validation and page parsing', () => {
    expect(parseSkillsShSlug('anthropics/skills/frontend-design')).toEqual({
      owner: 'anthropics',
      repo: 'skills',
      skillName: 'frontend-design',
    });

    expect(extractSkillsPageRecord('<a href="/anthropics/skills/frontend-design">Skill</a>', '/').skillLinks).toEqual([
      'anthropics/skills/frontend-design',
    ]);

    expect(() => parseSkillsShSlug('anthropics/skills')).toThrow(/Invalid skills.sh slug/);
  });
});

async function readFixture(fileName: string) {
  const fixtureUrl = new URL(`./fixtures/skills-sh/${fileName}`, import.meta.url);
  return readFile(fixtureUrl, 'utf8');
}

function htmlResponse(body: string) {
  return new Response(body, {
    status: 200,
    headers: { 'content-type': 'text/html; charset=utf-8' },
  });
}

function jsonResponse(body: unknown) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}
