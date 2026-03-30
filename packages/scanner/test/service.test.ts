import { describe, expect, it, vi } from 'vitest';
import { createScannerApp } from '../src/index';
import {
  buildPublishVerdict,
  buildScanOptions,
  executeScanJob,
  runFullSourceScrape,
  type ScannerSourceAdapter,
} from '../src/service';
import { buildFullClawHubScrapeUrl, runFullClawHubScrape } from '../scripts/full-scrape-clawhub';
import { buildFullSkillsShScrapeUrl, runFullSkillsShScrape } from '../scripts/full-scrape-skills';

describe('scanner service orchestration', () => {
  it('executes a scan job through fetch, scan, publish, and cleanup', async () => {
    const adapter = createAdapter();
    const scanSkill = vi.fn(async () => ({
      findings: [],
      findingsCount: 0,
      maxSeverity: 'low' as const,
      isSafe: true,
      scannerVersion: '2.5.0',
      analyzersUsed: ['static'] as const,
      policy: 'strict' as const,
    }));
    const publishResults = vi.fn(async () => ({ report: {}, keys: {} }));
    const removeDir = vi.fn(async () => {});

    const result = await executeScanJob(
      {
        source: 'clawhub',
        slug: 'team/trello',
        version: '1.2.3',
      },
      {
        adapters: { clawhub: adapter },
        scanSkill,
        publishResults,
        removeDir,
        logger: silentLogger(),
      },
    );

    expect(adapter.fetch).toHaveBeenCalledWith('team/trello', '1.2.3');
    expect(scanSkill).toHaveBeenCalledWith('/tmp/team-trello', buildScanOptions());
    expect(publishResults).toHaveBeenCalledWith(expect.objectContaining({
      source: 'clawhub',
      slug: 'team/trello',
      version: '1.2.3',
      verdict: buildPublishVerdict('low', 0),
    }));
    expect(removeDir).toHaveBeenCalledWith('/tmp/team-trello');
    expect(result).toEqual({
      source: 'clawhub',
      slug: 'team/trello',
      version: '1.2.3',
      verdict: {
        verdict: 'verified',
        severity: 'low',
        findingsCount: 0,
      },
    });
  });

  it('runs a full scrape sequentially, keeps going on failures, and includes metadata', async () => {
    const adapter = createAdapter({
      skills: [
        { slug: 'team/trello', name: 'Trello', latestVersion: '1.2.3' },
        { slug: 'team/broken', name: 'Broken Skill', latestVersion: '9.9.9' },
      ],
      fetch: vi
        .fn()
        .mockResolvedValueOnce('/tmp/team-trello')
        .mockRejectedValueOnce(new Error('download failed')),
    });
    const scanSkill = vi.fn(async () => ({
      findings: [
        {
          severity: 'medium' as const,
          category: 'prompt_injection',
          analyzer: 'llm',
          description: 'Potential prompt injection vector',
        },
      ],
      findingsCount: 1,
      maxSeverity: 'medium' as const,
      isSafe: false,
      scannerVersion: '2.5.0',
      analyzersUsed: ['static', 'llm'] as const,
      policy: 'strict' as const,
    }));
    const publishResults = vi.fn(async () => ({ report: {}, keys: {} }));
    const sleep = vi.fn(async () => {});
    const removeDir = vi.fn(async () => {});

    const result = await runFullSourceScrape(
      'clawhub',
      { interSkillDelayMs: 0 },
      {
        adapters: { clawhub: adapter },
        scanSkill,
        publishResults,
        sleep,
        removeDir,
        logger: silentLogger(),
      },
    );

    expect(adapter.listAll).toHaveBeenCalledTimes(1);
    expect(scanSkill).toHaveBeenCalledTimes(1);
    expect(publishResults).toHaveBeenCalledWith(expect.objectContaining({
      slug: 'team/trello',
      version: '1.2.3',
      metadata: {
        name: 'Trello',
        latestVersion: '1.2.3',
      },
      verdict: {
        verdict: 'caution',
        severity: 'medium',
        findingsCount: 1,
      },
    }));
    expect(removeDir).toHaveBeenCalledWith('/tmp/team-trello');
    expect(result).toEqual({
      source: 'clawhub',
      discovered: 2,
      attempted: 2,
      completed: 1,
      failed: 1,
      verdicts: {
        verified: 0,
        caution: 1,
        blocked: 0,
        pending: 0,
      },
    });
    expect(sleep).not.toHaveBeenCalled();
  });
});

describe('scanner service routes', () => {
  it('keeps scanner mutation auth optional when no token is configured', async () => {
    const adapter = createAdapter();
    const scanSkill = vi.fn(async () => ({
      findings: [],
      findingsCount: 0,
      maxSeverity: 'none' as const,
      isSafe: true,
      scannerVersion: '2.5.0',
      analyzersUsed: ['static'] as const,
      policy: 'strict' as const,
    }));
    const publishResults = vi.fn(async () => ({ report: {}, keys: {} }));
    const app = createScannerApp({
      adapters: { clawhub: adapter },
      scanSkill,
      publishResults,
      removeDir: vi.fn(async () => {}),
      logger: silentLogger(),
      authToken: '   ',
    });

    const response = await app.request('http://localhost/scan', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ source: 'clawhub', slug: 'team/trello', version: '1.2.3' }),
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      success: true,
      source: 'clawhub',
      slug: 'team/trello',
      version: '1.2.3',
      verdict: {
        verdict: 'verified',
        severity: 'none',
        findingsCount: 0,
      },
    });
  });

  it('rejects scan requests without the configured bearer token', async () => {
    const app = createScannerApp({
      adapters: { clawhub: createAdapter() },
      logger: silentLogger(),
      authToken: 'scanner-secret',
    });

    const response = await app.request('http://localhost/scan', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ source: 'clawhub', slug: 'team/trello' }),
    });

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({
      success: false,
      error: 'Unauthorized scanner mutation request.',
    });
  });

  it('accepts scan requests with the configured bearer token', async () => {
    const adapter = createAdapter();
    const scanSkill = vi.fn(async () => ({
      findings: [],
      findingsCount: 0,
      maxSeverity: 'none' as const,
      isSafe: true,
      scannerVersion: '2.5.0',
      analyzersUsed: ['static'] as const,
      policy: 'strict' as const,
    }));
    const publishResults = vi.fn(async () => ({ report: {}, keys: {} }));
    const app = createScannerApp({
      adapters: { clawhub: adapter },
      scanSkill,
      publishResults,
      removeDir: vi.fn(async () => {}),
      logger: silentLogger(),
      authToken: 'scanner-secret',
    });

    const response = await app.request('http://localhost/scan', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: 'Bearer scanner-secret',
      },
      body: JSON.stringify({ source: 'clawhub', slug: 'team/trello', version: '1.2.3' }),
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      success: true,
      source: 'clawhub',
      slug: 'team/trello',
      version: '1.2.3',
      verdict: {
        verdict: 'verified',
        severity: 'none',
        findingsCount: 0,
      },
    });
  });

  it('exposes the full ClawHub scrape path and supports wait=true for local smoke checks', async () => {
    const adapter = createAdapter({
      skills: [{ slug: 'team/trello', name: 'Trello', latestVersion: '1.2.3' }],
    });
    const scanSkill = vi.fn(async () => ({
      findings: [],
      findingsCount: 0,
      maxSeverity: 'none' as const,
      isSafe: true,
      scannerVersion: '2.5.0',
      analyzersUsed: ['static'] as const,
      policy: 'strict' as const,
    }));
    const publishResults = vi.fn(async () => ({ report: {}, keys: {} }));
    const app = createScannerApp({
      adapters: { clawhub: adapter },
      scanSkill,
      publishResults,
      removeDir: vi.fn(async () => {}),
      logger: silentLogger(),
    });

    const response = await app.request('http://localhost/scrape/clawhub?wait=true&limit=1&useLlm=false&delayMs=0', {
      method: 'POST',
      headers: {
        authorization: 'Bearer scanner-secret',
      },
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      started: true,
      source: 'clawhub',
      discovered: 1,
      attempted: 1,
      completed: 1,
      failed: 0,
      verdicts: {
        verified: 1,
        caution: 0,
        blocked: 0,
        pending: 0,
      },
    });
    expect(scanSkill).toHaveBeenCalledWith('/tmp/team-trello', expect.objectContaining({ useLlm: false }));
  });

  it('rejects malformed scan jobs with a 400', async () => {
    const app = createScannerApp({
      adapters: { clawhub: createAdapter() },
      logger: silentLogger(),
    });

    const response = await app.request('http://localhost/scan', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ source: 'clawhub' }),
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      success: false,
      error: 'Scan jobs require either a slug or repo field.',
    });
  });

  it('rejects scrape requests without the configured bearer token', async () => {
    const app = createScannerApp({
      adapters: { clawhub: createAdapter() },
      logger: silentLogger(),
      authToken: 'scanner-secret',
    });

    const response = await app.request('http://localhost/scrape/clawhub', {
      method: 'POST',
    });

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({
      success: false,
      error: 'Unauthorized scanner mutation request.',
    });
  });

  it('exposes the full skills.sh scrape path and supports wait=true for local smoke checks', async () => {
    const adapter = createAdapter({
      source: 'skills-sh',
      skills: [{ slug: 'anthropics/skills/frontend-design', name: 'frontend-design' }],
      fetchPath: '/tmp/frontend-design',
    });
    const scanSkill = vi.fn(async () => ({
      findings: [],
      findingsCount: 0,
      maxSeverity: 'none' as const,
      isSafe: true,
      scannerVersion: '2.5.0',
      analyzersUsed: ['static'] as const,
      policy: 'strict' as const,
    }));
    const publishResults = vi.fn(async () => ({ report: {}, keys: {} }));
    const app = createScannerApp({
      adapters: { 'skills-sh': adapter },
      scanSkill,
      publishResults,
      removeDir: vi.fn(async () => {}),
      logger: silentLogger(),
      authToken: 'scanner-secret',
    });

    const response = await app.request('http://localhost/scrape/skills-sh?wait=true&limit=1&useLlm=false&delayMs=0', {
      method: 'POST',
      headers: {
        authorization: 'Bearer scanner-secret',
      },
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      started: true,
      source: 'skills-sh',
      discovered: 1,
      attempted: 1,
      completed: 1,
      failed: 0,
      verdicts: {
        verified: 1,
        caution: 0,
        blocked: 0,
        pending: 0,
      },
    });
    expect(scanSkill).toHaveBeenCalledWith('/tmp/frontend-design', expect.objectContaining({ useLlm: false }));
    expect(publishResults).toHaveBeenCalledWith(expect.objectContaining({
      source: 'skills-sh',
      slug: 'anthropics/skills/frontend-design',
      version: 'latest',
      metadata: {
        name: 'frontend-design',
        latestVersion: 'latest',
        metadata: {
          repo: 'anthropics/skills',
        },
      },
    }));
  });
});

describe('full scrape helper script', () => {
  it('builds the expected scrape URL', () => {
    expect(buildFullClawHubScrapeUrl({ wait: true, limit: 2, useLlm: false, delayMs: 0 })).toBe(
      'http://localhost:3100/scrape/clawhub?wait=true&limit=2&useLlm=false&delayMs=0',
    );
  });

  it('posts to the scanner scrape endpoint', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ started: true }), { status: 200 }));

    const result = await runFullClawHubScrape({
      baseUrl: 'http://scanner.internal:3100',
      wait: true,
      limit: 1,
      useLlm: false,
      delayMs: 0,
      fetchImpl: fetchImpl as typeof fetch,
    });

    expect(fetchImpl).toHaveBeenCalledWith(
      'http://scanner.internal:3100/scrape/clawhub?wait=true&limit=1&useLlm=false&delayMs=0',
      { method: 'POST' },
    );
    expect(result).toEqual({
      endpoint: 'http://scanner.internal:3100/scrape/clawhub?wait=true&limit=1&useLlm=false&delayMs=0',
      ok: true,
      status: 200,
      body: { started: true },
    });
  });

  it('builds the expected skills.sh scrape URL', () => {
    expect(buildFullSkillsShScrapeUrl({ wait: true, limit: 2, useLlm: false, delayMs: 0 })).toBe(
      'http://localhost:3100/scrape/skills-sh?wait=true&limit=2&useLlm=false&delayMs=0',
    );
  });

  it('posts to the skills.sh scrape endpoint', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ started: true }), { status: 200 }));

    const result = await runFullSkillsShScrape({
      baseUrl: 'http://scanner.internal:3100',
      wait: true,
      limit: 1,
      useLlm: false,
      delayMs: 0,
      fetchImpl: fetchImpl as typeof fetch,
    });

    expect(fetchImpl).toHaveBeenCalledWith(
      'http://scanner.internal:3100/scrape/skills-sh?wait=true&limit=1&useLlm=false&delayMs=0',
      { method: 'POST' },
    );
    expect(result).toEqual({
      endpoint: 'http://scanner.internal:3100/scrape/skills-sh?wait=true&limit=1&useLlm=false&delayMs=0',
      ok: true,
      status: 200,
      body: { started: true },
    });
  });
});

function createAdapter(overrides: {
  source?: 'clawhub' | 'skills-sh';
  skills?: Array<{ slug: string; name: string; latestVersion?: string }>;
  fetch?: ReturnType<typeof vi.fn>;
  fetchPath?: string;
} = {}): ScannerSourceAdapter & { listAll: ReturnType<typeof vi.fn>; fetch: ReturnType<typeof vi.fn> } {
  const skills = overrides.skills ?? [{ slug: 'team/trello', name: 'Trello', latestVersion: '1.2.3' }];
  const source = overrides.source ?? 'clawhub';
  const fetchPath = overrides.fetchPath ?? '/tmp/team-trello';

  return {
    source,
    listAll: vi.fn(async () => skills),
    fetch: overrides.fetch ?? vi.fn(async () => fetchPath),
  };
}

function silentLogger() {
  return {
    log: vi.fn(),
    error: vi.fn(),
  };
}
