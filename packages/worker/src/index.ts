import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { renderDashboardPage } from '@skillshield/dashboard';
import { healthResponseSchema, queuedScanJobSchema, type QueuedScanJob } from '@skillshield/shared';
import { buildPublicBadgeUrl, buildPublicReportUrl } from './lib/public';
import {
  listRecentSkills,
  reconcileScrapeRunStatus,
  refreshScrapeRunCounters,
  updateScrapeJobStatus,
  updateScrapeRunStatus,
} from './lib/d1';
import { apiCompatibilityRoutes, apiRoutes } from './routes/api';
import { badgeRoutes } from './routes/badges';
import { clawhubRoutes } from './routes/clawhub';
import { reportsRoutes } from './routes/reports';
import { skillsRoutes } from './routes/skills';
import type { WorkerBindings } from './types';
import { webhookRoutes } from './routes/webhooks';
import { enterpriseClawhubRoutes, enterpriseSearchRoutes, enterpriseSkillsRoutes } from './routes/enterprise';

export function createApp() {
  const app = new Hono<{ Bindings: WorkerBindings }>();

  app.use(
    '*',
    cors({
      origin: '*',
      allowMethods: ['GET', 'POST'],
      allowHeaders: ['Content-Type', 'Authorization'],
    }),
  );

  app.get('/health', (c) => {
    const payload = healthResponseSchema.parse({
      status: 'ok',
      service: 'skillshield',
    });

    return c.json(payload, 200, {
      'Cache-Control': 'no-store',
    });
  });

  app.get('/', async (c) => {
    const stats = await c.env.DB.batch([
      c.env.DB.prepare('SELECT COUNT(*) as total FROM skills'),
      c.env.DB.prepare("SELECT COUNT(*) as count FROM skills WHERE verdict = 'verified'"),
      c.env.DB.prepare("SELECT COUNT(*) as count FROM skills WHERE verdict = 'caution'"),
      c.env.DB.prepare("SELECT COUNT(*) as count FROM skills WHERE verdict = 'blocked'"),
      c.env.DB.prepare("SELECT COUNT(*) as count FROM skills WHERE verdict = 'pending'"),
      c.env.DB.prepare('SELECT COUNT(*) as total FROM scan_runs'),
      c.env.DB.prepare('SELECT source, COUNT(*) as count FROM skills GROUP BY source ORDER BY source ASC'),
    ]);
    const recentSkills = await listRecentSkills(c.env.DB, 6);
    const html = renderDashboardPage({
      generatedAt: new Date().toISOString(),
      stats: {
        totalSkills: Number(getBatchValue(stats, 0, 'total')),
        verified: Number(getBatchValue(stats, 1, 'count')),
        caution: Number(getBatchValue(stats, 2, 'count')),
        blocked: Number(getBatchValue(stats, 3, 'count')),
        pending: Number(getBatchValue(stats, 4, 'count')),
        totalScans: Number(getBatchValue(stats, 5, 'total')),
        bySource: (stats[6]?.results ?? []).map((row) => {
          const sourceRow = row as Record<string, unknown>;

          return {
            source: String(sourceRow.source ?? 'unknown'),
            count: Number(sourceRow.count ?? 0),
          };
        }),
        lastUpdated: new Date().toISOString(),
      },
      recentSkills: recentSkills.map((skill) => ({
        source: skill.source,
        slug: skill.slug,
        name: skill.name,
        verdict: skill.verdict,
        severity: skill.scan_severity,
        findingsCount: skill.findings_count ?? 0,
        lastScannedAt: skill.last_scanned_at,
        reportUrl: buildPublicReportUrl(skill.source as 'clawhub' | 'skills-sh', skill.slug),
        badgeUrl: buildPublicBadgeUrl(skill.source as 'clawhub' | 'skills-sh', skill.slug),
      })),
    });

    return c.html(html, 200, {
      'Cache-Control': 'public, max-age=300',
    });
  });

  app.route('/clawhub/api/v1', clawhubRoutes);
  app.route('/skills', skillsRoutes);
  app.route('/api', apiCompatibilityRoutes);
  app.route('/api/v1', apiRoutes);
  app.route('/reports', reportsRoutes);
  app.route('/badge', badgeRoutes);
  app.route('/webhooks', webhookRoutes);

  // Enterprise routes — same CLI compatibility, stricter compliance verdicts
  app.route('/enterprise/clawhub/api/v1', enterpriseClawhubRoutes);
  app.route('/enterprise/skills', enterpriseSkillsRoutes);
  app.route('/enterprise/api', enterpriseSearchRoutes);

  app.notFound((c) =>
    c.json(
      {
        error: 'not_found',
        message: 'This skill has not been scanned by SkillShield.',
        docs: 'https://skillshield.cochat.ai/api/v1',
      },
      404,
    ),
  );

  return app;
}

function getBatchValue(results: D1Result<unknown>[], index: number, key: string) {
  const row = results[index]?.results?.[0] as Record<string, unknown> | undefined;
  return row?.[key] ?? 0;
}

const app = createApp();

export async function consumeScanQueue(batch: MessageBatch<unknown>, env: WorkerBindings) {
  for (const message of batch.messages) {
    const parsedJob = queuedScanJobSchema.safeParse(message.body);

    if (!parsedJob.success) {
      console.error('[queue] Dropping invalid scan job message', {
        messageId: message.id,
        issues: parsedJob.error.issues,
      });
      message.ack();
      continue;
    }

    if (isSourceDisabled(env, parsedJob.data.source)) {
      await recordTrackedJobStatus(
        () => markTrackedJobFailed(env, parsedJob.data, new Error(`Source is disabled: ${parsedJob.data.source}`)),
        message.id,
      );
      message.ack();
      continue;
    }

    try {
      await recordTrackedJobStatus(() => markTrackedJobRunning(env, parsedJob.data), message.id);

      const response = await fetch(buildScannerScanUrl(env.SCANNER_BASE_URL), {
        method: 'POST',
        headers: buildScannerHeaders(env),
        body: JSON.stringify(parsedJob.data),
        signal: AbortSignal.timeout(resolveScannerRequestTimeoutMs(env)),
      });

      if (!response.ok) {
        throw new Error(`Scanner responded with ${response.status}`);
      }

      await recordTrackedJobStatus(() => markTrackedJobCompleted(env, parsedJob.data), message.id);
      message.ack();
    } catch (error) {
      console.error('[queue] Failed to forward scan job to scanner', {
        messageId: message.id,
        error,
      });
      await recordTrackedJobStatus(() => markTrackedJobRetrying(env, parsedJob.data, message.attempts, error), message.id);
      message.retry();
    }
  }
}

async function recordTrackedJobStatus(operation: () => Promise<void>, messageId: string) {
  try {
    await operation();
  } catch (error) {
    console.error('[queue] Failed to update scrape tracking status', {
      messageId,
      error,
    });
  }
}

async function markTrackedJobRunning(env: WorkerBindings, job: QueuedScanJob) {
  const trackingInput = buildScrapeJobTrackingInput(job);
  if (!trackingInput) {
    return;
  }

  const now = new Date().toISOString();
  await updateScrapeRunStatus(env.DB, {
    id: trackingInput.runId,
    status: 'running',
    updatedAt: now,
  });
  await updateScrapeJobStatus(env.DB, {
    ...trackingInput,
    status: 'running',
    startedAt: now,
    updatedAt: now,
    incrementAttempts: true,
  });
  await refreshScrapeRunCounters(env.DB, trackingInput.runId);
}

async function markTrackedJobCompleted(env: WorkerBindings, job: QueuedScanJob) {
  const trackingInput = buildScrapeJobTrackingInput(job);
  if (!trackingInput) {
    return;
  }

  const now = new Date().toISOString();
  await updateScrapeJobStatus(env.DB, {
    ...trackingInput,
    status: 'completed',
    completedAt: now,
    updatedAt: now,
  });
  await refreshScrapeRunCounters(env.DB, trackingInput.runId);
  await reconcileScrapeRunStatus(env.DB, trackingInput.runId);
}

async function markTrackedJobFailed(env: WorkerBindings, job: QueuedScanJob, error: unknown) {
  const trackingInput = buildScrapeJobTrackingInput(job);
  if (!trackingInput) {
    return;
  }

  const now = new Date().toISOString();
  await updateScrapeJobStatus(env.DB, {
    ...trackingInput,
    status: 'failed',
    completedAt: now,
    updatedAt: now,
    error: error instanceof Error ? error.message : String(error),
  });
  await refreshScrapeRunCounters(env.DB, trackingInput.runId);
  await reconcileScrapeRunStatus(env.DB, trackingInput.runId);
}

async function markTrackedJobRetrying(env: WorkerBindings, job: QueuedScanJob, attempts: number, error: unknown) {
  const trackingInput = buildScrapeJobTrackingInput(job);
  if (!trackingInput) {
    return;
  }

  const now = new Date().toISOString();
  const status = attempts >= resolveScanQueueMaxAttempts(env) ? 'failed' : 'retrying';

  await updateScrapeJobStatus(env.DB, {
    ...trackingInput,
    status,
    completedAt: status === 'failed' ? now : undefined,
    updatedAt: now,
    error: error instanceof Error ? error.message : String(error),
  });
  await refreshScrapeRunCounters(env.DB, trackingInput.runId);
  await reconcileScrapeRunStatus(env.DB, trackingInput.runId);
}

function isSourceDisabled(env: Pick<WorkerBindings, 'DISABLED_SOURCES'>, source: string) {
  return (env.DISABLED_SOURCES ?? '')
    .split(',')
    .map((disabledSource) => disabledSource.trim())
    .some((disabledSource) => disabledSource === source);
}

function resolveScanQueueMaxAttempts(env: Pick<WorkerBindings, 'SCAN_QUEUE_MAX_ATTEMPTS'>) {
  const parsedAttempts = Number(env.SCAN_QUEUE_MAX_ATTEMPTS);

  if (!Number.isFinite(parsedAttempts) || parsedAttempts <= 0) {
    return 9;
  }

  return parsedAttempts;
}

function buildScrapeJobTrackingInput(job: QueuedScanJob) {
  const slug = job.slug ?? job.repo;

  if (!job.run_id || !slug || !job.version) {
    return undefined;
  }

  return {
    runId: job.run_id,
    source: job.source,
    slug,
    version: job.version,
  };
}

function resolveScannerRequestTimeoutMs(env: Pick<WorkerBindings, 'SCANNER_REQUEST_TIMEOUT_MS'>) {
  const parsedTimeout = Number(env.SCANNER_REQUEST_TIMEOUT_MS);

  if (!Number.isFinite(parsedTimeout) || parsedTimeout <= 0) {
    return 30_000;
  }

  return parsedTimeout;
}

function buildScannerScanUrl(baseUrl: string) {
  return new URL('/scan', baseUrl).toString();
}

function buildScannerHeaders(env: WorkerBindings) {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };

  if (env.SCANNER_AUTH_TOKEN) {
    headers.Authorization = `Bearer ${env.SCANNER_AUTH_TOKEN}`;
  }

  return headers;
}

const worker: ExportedHandler<WorkerBindings> & { request: typeof app.request } = {
  fetch: app.fetch,
  request: app.request,
  queue: consumeScanQueue,
};

export default worker;
