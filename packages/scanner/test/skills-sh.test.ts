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

  it('parses skills from fixture-backed skills.sh pages', async () => {
    const homeHtml = await readFixture('home.html');
    const trendingHtml = `
      <a href="/anthropics/skills/frontend-design">Duplicate</a>
      <a href="/openai/skills/prompt-reviewer">Prompt Reviewer</a>
    `;
    const hotHtml = '<a href="/cochat/skills/incident-response">Incident Response</a>';
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(htmlResponse(homeHtml))
      .mockResolvedValueOnce(htmlResponse(trendingHtml))
      .mockResolvedValueOnce(htmlResponse(hotHtml));
    const adapter = new SkillsShAdapter({
      baseUrl: 'https://skills.example',
      fetch: fetchMock as typeof fetch,
      cloneRepository: vi.fn(),
    });

    const result = await adapter.listAll();

    expect(result).toEqual([
      { slug: 'anthropics/skills/frontend-design', name: 'frontend-design' },
      { slug: 'vercel-labs/agent-skills/vercel-react-best-practices', name: 'vercel-react-best-practices' },
      { slug: 'openai/skills/prompt-reviewer', name: 'prompt-reviewer' },
      { slug: 'cochat/skills/incident-response', name: 'incident-response' },
    ]);
    expect(fetchMock).toHaveBeenNthCalledWith(1, 'https://skills.example');
    expect(fetchMock).toHaveBeenNthCalledWith(2, 'https://skills.example/trending');
    expect(fetchMock).toHaveBeenNthCalledWith(3, 'https://skills.example/hot');
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
