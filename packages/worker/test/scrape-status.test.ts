import { describe, expect, it } from 'vitest';
import app from '../src/index';
import type { WorkerBindings } from '../src/types';

describe('scrape status routes', () => {
  it('requires operator authorization for scrape run status', async () => {
    const response = await app.request('http://localhost/api/v1/scrape-runs', {}, createEnv());

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: 'unauthorized' });
  });

  it('returns recent scrape runs for authorized operators', async () => {
    const response = await app.request(
      'http://localhost/api/v1/scrape-runs?limit=5',
      { headers: { Authorization: 'Bearer scanner-secret' } },
      createEnv(),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    await expect(response.json()).resolves.toEqual({
      runs: [
        {
          id: 'run-1',
          source: 'clawhub',
          status: 'running',
          total_jobs: 3,
          queued_jobs: 1,
          running_jobs: 1,
          completed_jobs: 1,
          failed_jobs: 0,
          created_at: '2026-05-04T10:00:00.000Z',
          updated_at: '2026-05-04T10:02:00.000Z',
          completed_at: null,
          error: null,
        },
      ],
      count: 1,
    });
  });

  it('returns jobs for an authorized scrape run drill-down', async () => {
    const response = await app.request(
      'http://localhost/api/v1/scrape-runs/run-1/jobs?limit=10',
      { headers: { Authorization: 'Bearer scanner-secret' } },
      createEnv(),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      run_id: 'run-1',
      jobs: [
        {
          id: 'job-1',
          run_id: 'run-1',
          source: 'clawhub',
          slug: 'acme/trello',
          version: '1.2.3',
          status: 'completed',
          attempts: 1,
          queued_at: '2026-05-04T10:00:00.000Z',
          started_at: '2026-05-04T10:01:00.000Z',
          completed_at: '2026-05-04T10:02:00.000Z',
          updated_at: '2026-05-04T10:02:00.000Z',
          error: null,
        },
      ],
      count: 1,
    });
  });

  it('creates scrape runs for authorized scanner enqueue requests', async () => {
    const database = createRecordingDatabase();
    const response = await app.request(
      'http://localhost/api/v1/scrape-runs',
      {
        method: 'POST',
        headers: {
          Authorization: 'Bearer scanner-secret',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ id: 'run-2', source: 'skills-sh' }),
      },
      createEnv({ database }),
    );

    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toEqual({ success: true, id: 'run-2', existing: false });
    expect(database.statements[0]?.params).toEqual(['skills-sh']);
    expect(database.statements[1]?.params).toEqual(['run-2', 'skills-sh', expect.any(String), expect.any(String)]);
  });

  it('reuses active scrape runs unless force is requested', async () => {
    const database = createRecordingDatabase({ activeRunId: 'active-run' });
    const response = await app.request(
      'http://localhost/api/v1/scrape-runs',
      {
        method: 'POST',
        headers: {
          Authorization: 'Bearer scanner-secret',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ id: 'run-2', source: 'skills-sh' }),
      },
      createEnv({ database }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ success: true, id: 'active-run', existing: true });
    expect(database.statements).toHaveLength(1);
  });

  it('creates scrape jobs for authorized scanner enqueue requests', async () => {
    const database = createRecordingDatabase();
    const response = await app.request(
      'http://localhost/api/v1/scrape-runs/run-2/jobs',
      {
        method: 'POST',
        headers: {
          Authorization: 'Bearer scanner-secret',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          id: 'job-2',
          runId: 'run-2',
          source: 'skills-sh',
          slug: 'anthropics/skills/frontend-design',
          version: 'latest',
        }),
      },
      createEnv({ database }),
    );

    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toEqual({ success: true, id: 'job-2', skipped: false });
    expect(database.statements[0]?.params).toEqual([
      'job-2',
      'run-2',
      'skills-sh',
      'anthropics/skills/frontend-design',
      'latest',
      expect.any(String),
      expect.any(String),
    ]);
  });

  it('skips recently scanned jobs unless force is requested', async () => {
    const database = createRecordingDatabase({ recentlyScanned: true });
    const response = await app.request(
      'http://localhost/api/v1/scrape-runs/run-2/jobs',
      {
        method: 'POST',
        headers: {
          Authorization: 'Bearer scanner-secret',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          id: 'job-2',
          runId: 'run-2',
          source: 'skills-sh',
          slug: 'anthropics/skills/frontend-design',
          version: 'latest',
          recentScanMaxAgeHours: 168,
        }),
      },
      createEnv({ database }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      success: true,
      id: 'job-2',
      skipped: true,
      reason: 'recently_scanned',
    });
    expect(database.statements).toHaveLength(1);
    expect(database.statements[0]?.params.slice(0, 3)).toEqual([
      'skills-sh',
      'anthropics/skills/frontend-design',
      'latest',
    ]);
  });

  it('enqueues validated scan jobs for authorized scanner enqueue requests', async () => {
    const queue = createRecordingQueue();
    const response = await app.request(
      'http://localhost/api/v1/scan-queue',
      {
        method: 'POST',
        headers: {
          Authorization: 'Bearer scanner-secret',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          type: 'scan',
          source: 'skills-sh',
          slug: 'anthropics/skills/frontend-design',
          version: 'latest',
          run_id: 'run-2',
          job_id: 'job-2',
          triggered_by: 'full_scrape',
          event_id: 'run-2',
        }),
      },
      createEnv({ queue }),
    );

    expect(response.status).toBe(202);
    await expect(response.json()).resolves.toEqual({ success: true });
    expect(queue.messages).toEqual([
      {
        type: 'scan',
        source: 'skills-sh',
        slug: 'anthropics/skills/frontend-design',
        version: 'latest',
        run_id: 'run-2',
        job_id: 'job-2',
        triggered_by: 'full_scrape',
        event_id: 'run-2',
      },
    ]);
  });

  it('returns queue send failures to authorized scanner enqueue requests', async () => {
    const queue = createRecordingQueue({ sendError: new Error('Queue unavailable') });
    const response = await app.request(
      'http://localhost/api/v1/scan-queue',
      {
        method: 'POST',
        headers: {
          Authorization: 'Bearer scanner-secret',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          type: 'scan',
          source: 'skills-sh',
          slug: 'anthropics/skills/frontend-design',
          version: 'latest',
          run_id: 'run-2',
          job_id: 'job-2',
          triggered_by: 'full_scrape',
          event_id: 'run-2',
        }),
      },
      createEnv({ queue }),
    );

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toMatchObject({
      error: 'queue_send_failed',
      name: 'Error',
      message: 'Queue unavailable',
    });
  });

  it('refreshes counters and reconciles scrape run status', async () => {
    const database = createRecordingDatabase();
    const response = await app.request(
      'http://localhost/api/v1/scrape-runs/run-2/refresh-counters',
      {
        method: 'POST',
        headers: { Authorization: 'Bearer scanner-secret' },
      },
      createEnv({ database }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ success: true });
    expect(database.statements).toHaveLength(2);
    expect(database.statements[0]?.sql).toContain('total_jobs = (SELECT COUNT(*) FROM scrape_jobs');
    expect(database.statements[1]?.sql).toContain('status = CASE');
  });
});

function createEnv(options: { database?: D1Database; queue?: Queue } = {}): WorkerBindings {
  return {
    DB: options.database ?? createMockDatabase(),
    SKILLS_BUCKET: {} as R2Bucket,
    REPORTS_BUCKET: {} as R2Bucket,
    META_BUCKET: {} as R2Bucket,
    SCAN_QUEUE: options.queue ?? ({} as Queue),
    SCANNER_BASE_URL: 'https://skillshield-scanner.fly.dev',
    SCANNER_AUTH_TOKEN: 'scanner-secret',
    WEBHOOK_SECRET: 'webhook-secret',
    ENVIRONMENT: 'test',
  };
}

function createRecordingDatabase(options: { activeRunId?: string; recentlyScanned?: boolean } = {}) {
  const statements: Array<{ sql: string; params: unknown[] }> = [];

  return {
    statements,
    prepare(sql: string) {
      return {
        bind(...params: unknown[]) {
          statements.push({ sql, params });
          return this;
        },
        async run() {
          return { success: true } as D1Result<unknown>;
        },
        async first() {
          const normalizedSql = sql.replace(/\s+/g, ' ').trim();
          if (normalizedSql.includes('FROM scrape_runs')) {
            return options.activeRunId
              ? {
                id: options.activeRunId,
                source: 'skills-sh',
                status: 'running',
                total_jobs: 1,
                queued_jobs: 1,
                running_jobs: 0,
                completed_jobs: 0,
                failed_jobs: 0,
                created_at: '2026-05-04T10:00:00.000Z',
                updated_at: '2026-05-04T10:00:00.000Z',
                completed_at: null,
                error: null,
              }
              : null;
          }

          if (normalizedSql.includes('FROM scan_runs')) {
            return options.recentlyScanned ? { id: 'scan-1' } : null;
          }

          return null;
        },
      } as unknown as D1PreparedStatement;
    },
  } as D1Database & { statements: Array<{ sql: string; params: unknown[] }> };
}

function createRecordingQueue(options: { sendError?: Error } = {}) {
  const messages: unknown[] = [];

  return {
    messages,
    async send(message: unknown) {
      if (options.sendError) {
        throw options.sendError;
      }

      messages.push(message);
    },
  } as unknown as Queue & { messages: unknown[] };
}

function createMockDatabase(): D1Database {
  return {
    prepare(sql: string) {
      const normalizedSql = sql.replace(/\s+/g, ' ').trim();
      let boundParams: unknown[] = [];

      return {
        bind(...params: unknown[]) {
          boundParams = params;
          return this;
        },
        async all() {
          if (normalizedSql.includes('FROM scrape_runs')) {
            expect(boundParams).toEqual([5]);
            return {
              results: [
                {
                  id: 'run-1',
                  source: 'clawhub',
                  status: 'running',
                  total_jobs: 3,
                  queued_jobs: 1,
                  running_jobs: 1,
                  completed_jobs: 1,
                  failed_jobs: 0,
                  created_at: '2026-05-04T10:00:00.000Z',
                  updated_at: '2026-05-04T10:02:00.000Z',
                  completed_at: null,
                  error: null,
                },
              ],
            } as D1Result<unknown>;
          }

          if (normalizedSql.includes('FROM scrape_jobs')) {
            expect(boundParams).toEqual(['run-1', 10]);
            return {
              results: [
                {
                  id: 'job-1',
                  run_id: 'run-1',
                  source: 'clawhub',
                  slug: 'acme/trello',
                  version: '1.2.3',
                  status: 'completed',
                  attempts: 1,
                  queued_at: '2026-05-04T10:00:00.000Z',
                  started_at: '2026-05-04T10:01:00.000Z',
                  completed_at: '2026-05-04T10:02:00.000Z',
                  updated_at: '2026-05-04T10:02:00.000Z',
                  error: null,
                },
              ],
            } as D1Result<unknown>;
          }

          throw new Error(`Unhandled all() query: ${normalizedSql}`);
        },
      } as unknown as D1PreparedStatement;
    },
  } as D1Database;
}
