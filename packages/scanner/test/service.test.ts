import { describe, expect, it, vi } from 'vitest';
import { createScannerApp } from '../src/index';
import {
  buildPublishVerdict,
  buildScanOptions,
  enqueueFullSourceScrape,
  executeScanJob,
  runFullSourceScrape,
  type ScannerSourceAdapter,
} from '../src/service';
import { createHttpScrapeQueue } from '../src/scrape-queue';
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
        complianceVerdict: 'verified',
        complianceSeverity: 'low',
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
      metadata: expect.objectContaining({
        name: 'Trello',
        latestVersion: '1.2.3',
      }),
      verdict: {
        verdict: 'caution',
        severity: 'medium',
        findingsCount: 1,
        complianceVerdict: 'caution',
        complianceSeverity: 'medium',
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

  it('discovers skills, persists jobs, and enqueues bounded scan locators', async () => {
    const adapter = createAdapter({
      skills: [
        { slug: 'team/trello', name: 'Trello', latestVersion: '1.2.3' },
        { slug: 'team/github', name: 'GitHub', latestVersion: '2.0.0' },
      ],
    });
    const createScrapeRun = vi.fn(async (input) => ({ id: input.id, existing: false }));
    const createScrapeJob = vi.fn(async () => {});
    const enqueueScanJob = vi.fn(async () => {});
    const refreshScrapeRunCounters = vi.fn(async () => {});
    const ids = ['run-1', 'job-1'];

    const result = await enqueueFullSourceScrape(
      'clawhub',
      { limit: 1, scanOptions: { useLlm: false } },
      {
        adapters: { clawhub: adapter },
        scrapeQueue: {
          createScrapeRun,
          createScrapeJob,
          enqueueScanJob,
          refreshScrapeRunCounters,
          createId: () => ids.shift() ?? 'unexpected-id',
        },
        logger: silentLogger(),
      },
    );

    expect(createScrapeRun).toHaveBeenCalledWith({ id: 'run-1', source: 'clawhub', force: undefined });
    expect(adapter.listAll).toHaveBeenCalledWith(1);
    expect(createScrapeJob).toHaveBeenCalledWith({
      id: 'job-1',
      runId: 'run-1',
      source: 'clawhub',
      slug: 'team/trello',
      version: '1.2.3',
      force: undefined,
      recentScanMaxAgeHours: undefined,
    });
    expect(enqueueScanJob).toHaveBeenCalledWith({
      type: 'scan',
      source: 'clawhub',
      slug: 'team/trello',
      version: '1.2.3',
      useLlm: false,
      run_id: 'run-1',
      job_id: 'job-1',
      triggered_by: 'full_scrape',
      event_id: 'run-1',
    });
    expect(refreshScrapeRunCounters).toHaveBeenCalledWith('run-1');
    expect(result).toEqual({
      started: true,
      runId: 'run-1',
      source: 'clawhub',
      discovered: 2,
      queued: 1,
      skipped: 0,
    });
  });

  it('uses adapter-resolved versions when enqueueing scan jobs', async () => {
    const adapter = createAdapter({
      source: 'skills-sh',
      skills: [{ slug: 'anthropics/skills/frontend-design', name: 'frontend-design' }],
      resolveLatestVersion: vi.fn(async () => '0123456789abcdef0123456789abcdef01234567'),
    });
    const createScrapeJob = vi.fn(async () => {});
    const enqueueScanJob = vi.fn(async () => {});
    const ids = ['run-1', 'job-1'];

    const result = await enqueueFullSourceScrape(
      'skills-sh',
      { limit: 1, scanOptions: { useLlm: false } },
      {
        adapters: { 'skills-sh': adapter },
        scrapeQueue: {
          createScrapeRun: vi.fn(async (input) => ({ id: input.id, existing: false })),
          createScrapeJob,
          enqueueScanJob,
          createId: () => ids.shift() ?? 'unexpected-id',
        },
        logger: silentLogger(),
      },
    );

    expect(adapter.resolveLatestVersion).toHaveBeenCalledWith('anthropics/skills/frontend-design');
    expect(createScrapeJob).toHaveBeenCalledWith(expect.objectContaining({
      version: '0123456789abcdef0123456789abcdef01234567',
    }));
    expect(enqueueScanJob).toHaveBeenCalledWith(expect.objectContaining({
      version: '0123456789abcdef0123456789abcdef01234567',
    }));
    expect(result.queued).toBe(1);
  });

  it('reuses an active scrape run without rediscovering or enqueueing', async () => {
    const adapter = createAdapter();
    const createScrapeRun = vi.fn(async () => ({ id: 'existing-run', existing: true }));
    const createScrapeJob = vi.fn(async () => {});
    const enqueueScanJob = vi.fn(async () => {});

    const result = await enqueueFullSourceScrape('clawhub', {}, {
      adapters: { clawhub: adapter },
      scrapeQueue: {
        createScrapeRun,
        createScrapeJob,
        enqueueScanJob,
        createId: () => 'new-run',
      },
      logger: silentLogger(),
    });

    expect(adapter.listAll).not.toHaveBeenCalled();
    expect(createScrapeJob).not.toHaveBeenCalled();
    expect(enqueueScanJob).not.toHaveBeenCalled();
    expect(result).toEqual({
      started: true,
      runId: 'existing-run',
      source: 'clawhub',
      discovered: 0,
      queued: 0,
      skipped: 0,
      existingRun: true,
    });
  });

  it('skips recently scanned skills when the queue API asks it to', async () => {
    const adapter = createAdapter({
      skills: [{ slug: 'team/trello', name: 'Trello', latestVersion: '1.2.3' }],
    });
    const createScrapeJob = vi.fn(async () => ({ id: 'job-1', skipped: true, reason: 'recently_scanned' }));
    const enqueueScanJob = vi.fn(async () => {});

    const result = await enqueueFullSourceScrape('clawhub', { recentScanMaxAgeHours: 168 }, {
      adapters: { clawhub: adapter },
      scrapeQueue: {
        createScrapeRun: vi.fn(async (input) => ({ id: input.id, existing: false })),
        createScrapeJob,
        enqueueScanJob,
        createId: vi.fn().mockReturnValueOnce('run-1').mockReturnValueOnce('job-1'),
      },
      logger: silentLogger(),
    });

    expect(createScrapeJob).toHaveBeenCalledWith(expect.objectContaining({ recentScanMaxAgeHours: 168 }));
    expect(enqueueScanJob).not.toHaveBeenCalled();
    expect(result).toEqual({
      started: true,
      runId: 'run-1',
      source: 'clawhub',
      discovered: 1,
      queued: 0,
      skipped: 1,
    });
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
        complianceVerdict: 'verified',
        complianceSeverity: 'none',
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
        complianceVerdict: 'verified',
        complianceSeverity: 'none',
      },
    });
  });

  it('rejects scan requests for disabled sources', async () => {
    const app = createScannerApp({
      adapters: { clawhub: createAdapter() },
      logger: silentLogger(),
      authToken: 'scanner-secret',
      disabledSources: ['clawhub'],
    });

    const response = await app.request('http://localhost/scan', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: 'Bearer scanner-secret',
      },
      body: JSON.stringify({ source: 'clawhub', slug: 'team/trello', version: '1.2.3' }),
    });

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({
      success: false,
      error: 'Source is disabled: clawhub',
    });
  });

  it('returns a retryable busy response when the scanner is already running a job', async () => {
    let releaseScan: (() => void) | undefined;
    let resolveScanStarted: (() => void) | undefined;
    const scanStarted = new Promise<void>((resolve) => {
      resolveScanStarted = resolve;
    });
    const scanSkill = vi.fn(async () => {
      resolveScanStarted?.();
      await new Promise<void>((release) => {
        releaseScan = release;
      });

      return {
        findings: [],
        findingsCount: 0,
        maxSeverity: 'none' as const,
        isSafe: true,
        scannerVersion: '2.5.0',
        analyzersUsed: ['static'] as const,
        policy: 'strict' as const,
      };
    });
    const app = createScannerApp({
      adapters: { clawhub: createAdapter() },
      scanSkill,
      publishResults: vi.fn(async () => ({ report: {}, keys: {} })),
      removeDir: vi.fn(async () => {}),
      logger: silentLogger(),
      authToken: 'scanner-secret',
      maxConcurrentScans: 1,
    });

    const firstRequest = app.request('http://localhost/scan', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: 'Bearer scanner-secret',
      },
      body: JSON.stringify({ source: 'clawhub', slug: 'team/trello', version: '1.2.3' }),
    });

    await scanStarted;
    const response = await app.request('http://localhost/scan', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: 'Bearer scanner-secret',
      },
      body: JSON.stringify({ source: 'clawhub', slug: 'team/github', version: '2.0.0' }),
    });

    expect(response.status).toBe(503);
    expect(response.headers.get('retry-after')).toBe('30');
    await expect(response.json()).resolves.toEqual({
      success: false,
      error: 'Scanner is busy. Retry later.',
    });

    releaseScan?.();
    await firstRequest;
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

  it('rejects scrape requests for disabled sources', async () => {
    const app = createScannerApp({
      adapters: { clawhub: createAdapter() },
      logger: silentLogger(),
      authToken: 'scanner-secret',
      disabledSources: ['clawhub'],
    });

    const response = await app.request('http://localhost/scrape/clawhub?limit=1', {
      method: 'POST',
      headers: {
        authorization: 'Bearer scanner-secret',
      },
    });

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({
      success: false,
      error: 'Source is disabled: clawhub',
    });
  });

  it('enqueues full scrape requests by default without scanning inline', async () => {
    const adapter = createAdapter({
      skills: [
        { slug: 'team/trello', name: 'Trello', latestVersion: '1.2.3' },
        { slug: 'team/github', name: 'GitHub', latestVersion: '2.0.0' },
      ],
    });
    const scanSkill = vi.fn();
    const createScrapeRun = vi.fn(async (input) => ({ id: input.id, existing: false }));
    const createScrapeJob = vi.fn(async () => {});
    const enqueueScanJob = vi.fn(async () => {});
    const ids = ['run-2', 'job-2'];
    const app = createScannerApp({
      adapters: { clawhub: adapter },
      scanSkill,
      scrapeQueue: {
        createScrapeRun,
        createScrapeJob,
        enqueueScanJob,
        createId: () => ids.shift() ?? 'unexpected-id',
      },
      logger: silentLogger(),
      authToken: 'scanner-secret',
    });

    const response = await app.request('http://localhost/scrape/clawhub?limit=1&useLlm=false', {
      method: 'POST',
      headers: {
        authorization: 'Bearer scanner-secret',
      },
    });

    expect(response.status).toBe(202);
    await expect(response.json()).resolves.toEqual({
      started: true,
      runId: 'run-2',
      source: 'clawhub',
      discovered: 2,
      queued: 1,
      skipped: 0,
    });
    expect(createScrapeRun).toHaveBeenCalledTimes(1);
    expect(createScrapeJob).toHaveBeenCalledTimes(1);
    expect(enqueueScanJob).toHaveBeenCalledWith(expect.objectContaining({
      type: 'scan',
      source: 'clawhub',
      slug: 'team/trello',
      version: '1.2.3',
      useLlm: false,
    }));
    expect(scanSkill).not.toHaveBeenCalled();
  });

  it('starts unbounded queue-backed scrapes in the background', async () => {
    const adapter = createAdapter({
      source: 'skills-sh',
      skills: [{ slug: 'anthropics/skills/frontend-design', name: 'frontend-design' }],
      resolveLatestVersion: vi.fn(async () => '0123456789abcdef0123456789abcdef01234567'),
    });
    const backgroundRunner = vi.fn((task: Promise<unknown>) => {
      task.catch(() => undefined);
    });
    const createScrapeRun = vi.fn(async (input) => ({ id: input.id, existing: false }));
    const app = createScannerApp({
      adapters: { 'skills-sh': adapter },
      scrapeQueue: {
        createScrapeRun,
        createScrapeJob: vi.fn(async () => {}),
        enqueueScanJob: vi.fn(async () => {}),
      },
      backgroundRunner,
      logger: silentLogger(),
      authToken: 'scanner-secret',
    });

    const response = await app.request('http://localhost/scrape/skills-sh?useLlm=false', {
      method: 'POST',
      headers: {
        authorization: 'Bearer scanner-secret',
      },
    });
    const body = await response.json() as { started: boolean; runId: string; source: string; background: boolean };

    expect(response.status).toBe(202);
    expect(body).toMatchObject({ started: true, source: 'skills-sh', background: true });
    expect(body.runId).toMatch(/[0-9a-f-]{36}/);
    expect(backgroundRunner).toHaveBeenCalledTimes(1);
    expect(createScrapeRun).toHaveBeenCalledWith({ id: body.runId, source: 'skills-sh', force: false });
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
      metadata: expect.objectContaining({
        name: 'frontend-design',
        latestVersion: 'latest',
        metadata: {
          repo: 'anthropics/skills',
        },
      }),
    }));
  });
});

describe('HTTP scrape queue', () => {
  it('posts scrape tracking and queue operations to the Worker API', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ success: true }), { status: 202 }));
    const scrapeQueue = createHttpScrapeQueue({
      baseUrl: 'https://skillshield.example',
      authToken: 'scanner-secret',
      fetchImpl: fetchMock as unknown as typeof fetch,
    });

    await scrapeQueue.createScrapeRun({ id: 'run-1', source: 'clawhub' });
    await scrapeQueue.createScrapeJob({
      id: 'job-1',
      runId: 'run-1',
      source: 'clawhub',
      slug: 'team/trello',
      version: '1.2.3',
    });
    await scrapeQueue.enqueueScanJob({
      type: 'scan',
      source: 'clawhub',
      slug: 'team/trello',
      version: '1.2.3',
      run_id: 'run-1',
      job_id: 'job-1',
      triggered_by: 'full_scrape',
      event_id: 'run-1',
    });
    await scrapeQueue.refreshScrapeRunCounters?.('run-1');

    expect(fetchMock.mock.calls.map((call) => String(call[0]))).toEqual([
      'https://skillshield.example/api/v1/scrape-runs',
      'https://skillshield.example/api/v1/scrape-runs/run-1/jobs',
      'https://skillshield.example/api/v1/scan-queue',
      'https://skillshield.example/api/v1/scrape-runs/run-1/refresh-counters',
    ]);
    for (const [, init] of fetchMock.mock.calls) {
      expect(init).toMatchObject({
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer scanner-secret',
        },
      });
    }
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
  resolveLatestVersion?: ReturnType<typeof vi.fn>;
} = {}): ScannerSourceAdapter & { listAll: ReturnType<typeof vi.fn>; fetch: ReturnType<typeof vi.fn>; resolveLatestVersion?: ReturnType<typeof vi.fn> } {
  const skills = overrides.skills ?? [{ slug: 'team/trello', name: 'Trello', latestVersion: '1.2.3' }];
  const source = overrides.source ?? 'clawhub';
  const fetchPath = overrides.fetchPath ?? '/tmp/team-trello';

  return {
    source,
    listAll: vi.fn(async () => skills),
    fetch: overrides.fetch ?? vi.fn(async () => fetchPath),
    resolveLatestVersion: overrides.resolveLatestVersion,
  };
}

function silentLogger() {
  return {
    log: vi.fn(),
    error: vi.fn(),
  };
}
