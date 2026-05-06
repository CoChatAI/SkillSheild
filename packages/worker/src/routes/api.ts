import { Hono } from 'hono';
import { queuedScanJobSchema, searchResponseSchema, sourceSchema } from '@skillshield/shared';
import {
  createScrapeRun,
  getActiveScrapeRun,
  getSkillBySourceAndSlug,
  hasRecentCompletedScan,
  listRecentScrapeRuns,
  listRecentSkills,
  listQueuedScrapeJobsForRun,
  listScrapeJobsForRun,
  parseSkillMetadata,
  parseSkillSearchSort,
  reconcileScrapeRunStatus,
  searchSkills,
  upsertScrapeJob,
  refreshScrapeRunCounters,
  type ScrapeJobRow,
  type ScrapeRunRow,
  type SkillRow,
} from '../lib/d1';
import { buildPublicBadgeUrl, buildPublicReportUrl } from '../lib/public';
import type { WorkerBindings } from '../types';

export const apiRoutes = new Hono<{ Bindings: WorkerBindings }>();
export const apiCompatibilityRoutes = new Hono<{ Bindings: WorkerBindings }>();

apiCompatibilityRoutes.get('/search', async (c) => {
  const requestedLimit = Number.parseInt(c.req.query('limit') ?? '10', 10);
  const limit = Number.isNaN(requestedLimit) ? 10 : Math.min(Math.max(requestedLimit, 1), 100);
  const query = c.req.query('q')?.trim();
  const results = await searchSkills(c.env.DB, {
    limit: Math.max(limit * 2, limit),
    offset: 0,
    query: query && query.length > 0 ? query : undefined,
    source: 'skills-sh',
    sort: 'installs:desc',
  });
  const skills = results
    .filter((row) => row.verdict === 'verified' || row.verdict === 'caution')
    .slice(0, limit)
    .map(buildSkillsShCompatibilityRecord);

  return c.json({ skills });
});

apiRoutes.get('/search', async (c) => {
  const requestedLimit = Number.parseInt(c.req.query('limit') ?? '25', 10);
  const limit = Number.isNaN(requestedLimit) ? 25 : Math.min(Math.max(requestedLimit, 1), 100);
  const requestedOffset = Number.parseInt(c.req.query('offset') ?? '0', 10);
  const offset = Number.isNaN(requestedOffset) ? 0 : Math.max(requestedOffset, 0);
  const query = c.req.query('q')?.trim();
  const source = c.req.query('source')?.trim();
  const verdict = c.req.query('verdict')?.trim();
  const category = c.req.query('category')?.trim();
  const sort = parseSkillSearchSort(c.req.query('sort'));

  const results = await searchSkills(c.env.DB, {
    limit,
    offset,
    query: query && query.length > 0 ? query : undefined,
    source: source && source.length > 0 ? source : undefined,
    verdict: verdict && verdict.length > 0 ? verdict : undefined,
    category: category && category.length > 0 ? category : undefined,
    sort,
  });

  return c.json(
    searchResponseSchema.parse({
      skills: results.map(buildSearchSkillRecord),
      count: results.length,
      offset,
    }),
  );
});

apiRoutes.get('/verify/:source/:slug{.+}', async (c) => {
  const { source, slug } = c.req.param();
  const skill = await getSkillBySourceAndSlug(c.env.DB, source, slug);

  if (!skill) {
    return c.json({ verified: false, reason: 'not_scanned' }, 404);
  }

  return c.json({
    verified: skill.verdict === 'verified',
    verdict: skill.verdict,
    severity: skill.scan_severity,
    findings: skill.findings_count ?? 0,
    scanned_at: skill.last_scanned_at,
    report: buildPublicReportUrl(skill.source as 'clawhub' | 'skills-sh', skill.slug),
    badge: buildPublicBadgeUrl(skill.source as 'clawhub' | 'skills-sh', skill.slug),
  });
});

apiRoutes.get('/stats', async (c) => {
  const stats = await c.env.DB.batch([
    c.env.DB.prepare('SELECT COUNT(*) as total FROM skills'),
    c.env.DB.prepare("SELECT COUNT(*) as count FROM skills WHERE verdict = 'verified'"),
    c.env.DB.prepare("SELECT COUNT(*) as count FROM skills WHERE verdict = 'caution'"),
    c.env.DB.prepare("SELECT COUNT(*) as count FROM skills WHERE verdict = 'blocked'"),
    c.env.DB.prepare("SELECT COUNT(*) as count FROM skills WHERE verdict = 'pending'"),
    c.env.DB.prepare('SELECT COUNT(*) as total FROM scan_runs'),
    c.env.DB.prepare('SELECT source, COUNT(*) as count FROM skills GROUP BY source ORDER BY source ASC'),
  ]);

  return c.json({
    total_skills: Number(getBatchValue(stats, 0, 'total')),
    verified: Number(getBatchValue(stats, 1, 'count')),
    caution: Number(getBatchValue(stats, 2, 'count')),
    blocked: Number(getBatchValue(stats, 3, 'count')),
    pending: Number(getBatchValue(stats, 4, 'count')),
    total_scans: Number(getBatchValue(stats, 5, 'total')),
    by_source: stats[6]?.results ?? [],
    last_updated: new Date().toISOString(),
  });
});

apiRoutes.get('/recent', async (c) => {
  const requestedLimit = Number.parseInt(c.req.query('limit') ?? '10', 10);
  const limit = Number.isNaN(requestedLimit) ? 10 : Math.min(Math.max(requestedLimit, 1), 100);
  const skills = await listRecentSkills(c.env.DB, limit);

  return c.json({
    skills: skills.map(buildRecentSkillRecord),
    count: skills.length,
  });
});

apiRoutes.get('/scrape-runs', async (c) => {
  if (!isAuthorizedOperatorRequest(c.req.raw, c.env)) {
    return c.json({ error: 'unauthorized' }, 401, { 'Cache-Control': 'no-store' });
  }

  const requestedLimit = Number.parseInt(c.req.query('limit') ?? '20', 10);
  const limit = Number.isNaN(requestedLimit) ? 20 : Math.min(Math.max(requestedLimit, 1), 100);
  const runs = await listRecentScrapeRuns(c.env.DB, limit);

  return c.json({
    runs: runs.map(buildScrapeRunRecord),
    count: runs.length,
  }, 200, { 'Cache-Control': 'no-store' });
});

apiRoutes.post('/scrape-runs', async (c) => {
  if (!isAuthorizedOperatorRequest(c.req.raw, c.env)) {
    return c.json({ error: 'unauthorized' }, 401, { 'Cache-Control': 'no-store' });
  }

  const parsedBody = parseCreateScrapeRunRequest(await c.req.json());
  if (!parsedBody.success) {
    return c.json({ error: parsedBody.error }, 400, { 'Cache-Control': 'no-store' });
  }

  if (!parsedBody.data.force) {
    const activeRun = await getActiveScrapeRun(c.env.DB, parsedBody.data.source);
    if (activeRun) {
      return c.json({ success: true, id: activeRun.id, existing: true }, 200, { 'Cache-Control': 'no-store' });
    }
  }

  await createScrapeRun(c.env.DB, parsedBody.data);

  return c.json({ success: true, id: parsedBody.data.id, existing: false }, 201, { 'Cache-Control': 'no-store' });
});

apiRoutes.get('/scrape-runs/:runId/jobs', async (c) => {
  if (!isAuthorizedOperatorRequest(c.req.raw, c.env)) {
    return c.json({ error: 'unauthorized' }, 401, { 'Cache-Control': 'no-store' });
  }

  const requestedLimit = Number.parseInt(c.req.query('limit') ?? '100', 10);
  const limit = Number.isNaN(requestedLimit) ? 100 : Math.min(Math.max(requestedLimit, 1), 500);
  const jobs = await listScrapeJobsForRun(c.env.DB, c.req.param('runId'), limit);

  return c.json({
    run_id: c.req.param('runId'),
    jobs: jobs.map(buildScrapeJobRecord),
    count: jobs.length,
  }, 200, { 'Cache-Control': 'no-store' });
});

apiRoutes.post('/scrape-runs/:runId/jobs', async (c) => {
  if (!isAuthorizedOperatorRequest(c.req.raw, c.env)) {
    return c.json({ error: 'unauthorized' }, 401, { 'Cache-Control': 'no-store' });
  }

  const runId = c.req.param('runId');
  const parsedBody = parseCreateScrapeJobRequest(await c.req.json());
  if (!parsedBody.success) {
    return c.json({ error: parsedBody.error }, 400, { 'Cache-Control': 'no-store' });
  }

  if (parsedBody.data.runId !== runId) {
    return c.json({ error: 'Scrape job runId must match the route runId.' }, 400, { 'Cache-Control': 'no-store' });
  }

  if (!parsedBody.data.force && typeof parsedBody.data.recentScanMaxAgeHours === 'number' && parsedBody.data.recentScanMaxAgeHours > 0) {
    const since = new Date(Date.now() - parsedBody.data.recentScanMaxAgeHours * 60 * 60 * 1000).toISOString();
    const recentlyScanned = await hasRecentCompletedScan(c.env.DB, {
      source: parsedBody.data.source,
      slug: parsedBody.data.slug,
      version: parsedBody.data.version,
      since,
    });

    if (recentlyScanned) {
      return c.json({ success: true, id: parsedBody.data.id, skipped: true, reason: 'recently_scanned' }, 200, { 'Cache-Control': 'no-store' });
    }
  }

  await upsertScrapeJob(c.env.DB, parsedBody.data);

  return c.json({ success: true, id: parsedBody.data.id, skipped: false }, 201, { 'Cache-Control': 'no-store' });
});

apiRoutes.post('/scrape-runs/:runId/refresh-counters', async (c) => {
  if (!isAuthorizedOperatorRequest(c.req.raw, c.env)) {
    return c.json({ error: 'unauthorized' }, 401, { 'Cache-Control': 'no-store' });
  }

  await refreshScrapeRunCounters(c.env.DB, c.req.param('runId'));
  await reconcileScrapeRunStatus(c.env.DB, c.req.param('runId'));

  return c.json({ success: true }, 200, { 'Cache-Control': 'no-store' });
});

apiRoutes.post('/scrape-runs/:runId/requeue', async (c) => {
  if (!isAuthorizedOperatorRequest(c.req.raw, c.env)) {
    return c.json({ error: 'unauthorized' }, 401, { 'Cache-Control': 'no-store' });
  }

  const requestedLimit = Number.parseInt(c.req.query('limit') ?? '500', 10);
  const limit = Number.isNaN(requestedLimit) ? 500 : Math.min(Math.max(requestedLimit, 1), 5000);
  const runId = c.req.param('runId');
  const jobs = await listQueuedScrapeJobsForRun(c.env.DB, runId, limit);
  const messages = jobs.map((job) => queuedScanJobSchema.parse({
    type: 'scan',
    source: job.source,
    slug: job.slug,
    version: job.version,
    run_id: job.run_id,
    job_id: job.id,
    triggered_by: 'full_scrape_requeue',
    event_id: runId,
  }));

  for (const batch of chunk(messages, 100)) {
    await c.env.SCAN_QUEUE.sendBatch(batch.map((body) => ({ body })));
  }

  return c.json({ success: true, run_id: runId, requeued: messages.length }, 202, { 'Cache-Control': 'no-store' });
});

apiRoutes.post('/scan-queue', async (c) => {
  if (!isAuthorizedOperatorRequest(c.req.raw, c.env)) {
    return c.json({ error: 'unauthorized' }, 401, { 'Cache-Control': 'no-store' });
  }

  const parsedBody = queuedScanJobSchema.safeParse(await c.req.json());
  if (!parsedBody.success) {
    return c.json({ error: parsedBody.error.issues[0]?.message ?? 'Invalid scan queue payload.' }, 400, { 'Cache-Control': 'no-store' });
  }

  await c.env.SCAN_QUEUE.send(parsedBody.data);

  return c.json({ success: true }, 202, { 'Cache-Control': 'no-store' });
});

function buildSearchSkillRecord(row: SkillRow) {
  return {
    id: row.id,
    source: row.source,
    slug: row.slug,
    name: row.name,
    description: row.description,
    author: row.author,
    category: row.category ?? null,
    latestVersion: row.latest_version,
    latestScannedVersion: row.latest_scanned_version,
    verdict: row.verdict,
    scanSeverity: row.scan_severity,
    findingsCount: row.findings_count ?? 0,
    installs: row.installs ?? 0,
    installsUpdatedAt: row.installs_updated_at ?? null,
    firstSeenAt: row.first_seen_at ?? row.last_updated_at ?? new Date(0).toISOString(),
    lastScannedAt: row.last_scanned_at,
    lastUpdatedAt: row.last_updated_at ?? new Date(0).toISOString(),
    r2Key: row.r2_key,
    reportR2Key: row.report_r2_key,
    metadata: parseSkillMetadata(row.metadata),
  };
}

function buildRecentSkillRecord(row: SkillRow) {
  return {
    source: row.source,
    slug: row.slug,
    name: row.name,
    verdict: row.verdict,
    severity: row.scan_severity,
    findings_count: row.findings_count ?? 0,
    last_scanned_at: row.last_scanned_at,
    report: buildPublicReportUrl(row.source as 'clawhub' | 'skills-sh', row.slug),
    badge: buildPublicBadgeUrl(row.source as 'clawhub' | 'skills-sh', row.slug),
  };
}

function buildScrapeRunRecord(row: ScrapeRunRow) {
  return {
    id: row.id,
    source: row.source,
    status: row.status,
    total_jobs: row.total_jobs,
    queued_jobs: row.queued_jobs,
    running_jobs: row.running_jobs,
    completed_jobs: row.completed_jobs,
    failed_jobs: row.failed_jobs,
    created_at: row.created_at,
    updated_at: row.updated_at,
    completed_at: row.completed_at,
    error: row.error,
  };
}

function buildScrapeJobRecord(row: ScrapeJobRow) {
  return {
    id: row.id,
    run_id: row.run_id,
    source: row.source,
    slug: row.slug,
    version: row.version,
    status: row.status,
    attempts: row.attempts,
    queued_at: row.queued_at,
    started_at: row.started_at,
    completed_at: row.completed_at,
    updated_at: row.updated_at,
    error: row.error,
  };
}

function isAuthorizedOperatorRequest(request: Request, env: WorkerBindings) {
  const authorizationHeader = request.headers.get('Authorization');
  const validTokens = [env.SCANNER_AUTH_TOKEN, env.WEBHOOK_SECRET].filter((token): token is string => {
    return typeof token === 'string' && token.length > 0;
  });

  return validTokens.some((token) => authorizationHeader === `Bearer ${token}`);
}

function chunk<T>(items: T[], size: number) {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }

  return chunks;
}

function parseCreateScrapeRunRequest(body: unknown) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { success: false as const, error: 'Invalid scrape run payload.' };
  }

  const record = body as Record<string, unknown>;
  const id = normalizeRequiredString(record.id);
  const source = sourceSchema.safeParse(record.source);
  const force = normalizeOptionalBoolean(record.force);

  if (!id || !source.success || force === 'invalid') {
    return { success: false as const, error: 'Invalid scrape run payload.' };
  }

  return { success: true as const, data: { id, source: source.data, force: force ?? false } };
}

function parseCreateScrapeJobRequest(body: unknown) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { success: false as const, error: 'Invalid scrape job payload.' };
  }

  const record = body as Record<string, unknown>;
  const id = normalizeRequiredString(record.id);
  const runId = normalizeRequiredString(record.runId);
  const source = sourceSchema.safeParse(record.source);
  const slug = normalizeRequiredString(record.slug);
  const version = normalizeRequiredString(record.version);
  const force = normalizeOptionalBoolean(record.force);
  const recentScanMaxAgeHours = normalizeOptionalNonNegativeNumber(record.recentScanMaxAgeHours);

  if (!id || !runId || !source.success || !slug || !version || force === 'invalid' || recentScanMaxAgeHours === 'invalid') {
    return { success: false as const, error: 'Invalid scrape job payload.' };
  }

  return {
    success: true as const,
    data: {
      id,
      runId,
      source: source.data,
      slug,
      version,
      force: force ?? false,
      recentScanMaxAgeHours,
    },
  };
}

function normalizeOptionalBoolean(value: unknown) {
  if (value === undefined) {
    return undefined;
  }

  if (typeof value === 'boolean') {
    return value;
  }

  return 'invalid' as const;
}

function normalizeOptionalNonNegativeNumber(value: unknown) {
  if (value === undefined) {
    return undefined;
  }

  if (typeof value === 'number' && Number.isFinite(value) && value >= 0) {
    return value;
  }

  return 'invalid' as const;
}

function normalizeRequiredString(value: unknown) {
  if (typeof value !== 'string') {
    return undefined;
  }

  const trimmedValue = value.trim();
  return trimmedValue ? trimmedValue : undefined;
}

function buildSkillsShCompatibilityRecord(row: SkillRow) {
  const metadata = parseSkillMetadata(row.metadata);
  const slugParts = row.slug.split('/');
  const derivedSource = slugParts.length >= 2 ? `${slugParts[0]}/${slugParts[1]}` : row.slug;
  const source = typeof metadata.repo === 'string' && metadata.repo.trim().length > 0
    ? metadata.repo.trim()
    : derivedSource;

  return {
    id: row.slug,
    name: row.name,
    installs: row.installs ?? 0,
    source,
  };
}

function getBatchValue(results: D1Result<unknown>[], index: number, key: string) {
  const row = results[index]?.results?.[0] as Record<string, unknown> | undefined;
  return row?.[key] ?? 0;
}
