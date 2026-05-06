import { describe, expect, it, vi } from 'vitest';
import {
  createScrapeRun,
  listRecentScrapeRuns,
  listScrapeJobsForRun,
  reconcileScrapeRunStatus,
  refreshScrapeRunCounters,
  updateScrapeJobStatus,
  updateScrapeRunStatus,
  upsertScrapeJob,
} from '../src/lib/d1';

describe('D1 scrape tracking helpers', () => {
  it('creates scrape runs idempotently', async () => {
    const database = createRecordingDatabase();

    await createScrapeRun(database, {
      id: 'run-1',
      source: 'skills-sh',
      createdAt: '2026-05-04T10:00:00.000Z',
    });

    expect(database.statements[0]?.sql).toContain('INSERT INTO scrape_runs');
    expect(database.statements[0]?.sql).toContain('ON CONFLICT(id) DO UPDATE');
    expect(database.statements[0]?.params).toEqual([
      'run-1',
      'skills-sh',
      '2026-05-04T10:00:00.000Z',
      '2026-05-04T10:00:00.000Z',
    ]);
  });

  it('updates scrape run status and terminal details', async () => {
    const database = createRecordingDatabase();

    await updateScrapeRunStatus(database, {
      id: 'run-1',
      status: 'failed',
      updatedAt: '2026-05-04T10:05:00.000Z',
      completedAt: '2026-05-04T10:05:00.000Z',
      error: 'discovery failed',
    });

    expect(database.statements[0]?.sql).toContain('UPDATE scrape_runs SET');
    expect(database.statements[0]?.params).toEqual([
      'failed',
      '2026-05-04T10:05:00.000Z',
      '2026-05-04T10:05:00.000Z',
      'discovery failed',
      'run-1',
    ]);
  });

  it('upserts scrape jobs without resetting existing job state', async () => {
    const database = createRecordingDatabase();

    await upsertScrapeJob(database, {
      id: 'job-1',
      runId: 'run-1',
      source: 'clawhub',
      slug: 'acme/trello',
      version: '1.2.3',
      queuedAt: '2026-05-04T10:01:00.000Z',
    });

    expect(database.statements[0]?.sql).toContain('INSERT INTO scrape_jobs');
    expect(database.statements[0]?.sql).toContain('ON CONFLICT(run_id, source, slug, version) DO UPDATE');
    expect(database.statements[0]?.sql).not.toContain('status = excluded.status');
    expect(database.statements[0]?.params).toEqual([
      'job-1',
      'run-1',
      'clawhub',
      'acme/trello',
      '1.2.3',
      '2026-05-04T10:01:00.000Z',
      '2026-05-04T10:01:00.000Z',
    ]);
  });

  it('updates scrape jobs and can increment attempts for dispatch', async () => {
    const database = createRecordingDatabase();

    await updateScrapeJobStatus(database, {
      runId: 'run-1',
      source: 'skills-sh',
      slug: 'owner/repo/skill',
      version: 'main',
      status: 'running',
      startedAt: '2026-05-04T10:02:00.000Z',
      updatedAt: '2026-05-04T10:02:00.000Z',
      incrementAttempts: true,
    });

    expect(database.statements[0]?.sql).toContain('attempts = attempts + 1');
    expect(database.statements[0]?.params).toEqual([
      'running',
      '2026-05-04T10:02:00.000Z',
      null,
      '2026-05-04T10:02:00.000Z',
      null,
      'run-1',
      'skills-sh',
      'owner/repo/skill',
      'main',
    ]);
  });

  it('refreshes scrape run counters from job status totals', async () => {
    const database = createRecordingDatabase();

    await refreshScrapeRunCounters(database, 'run-1');

    expect(database.statements[0]?.sql).toContain('total_jobs = (SELECT COUNT(*) FROM scrape_jobs WHERE run_id = ?)');
    expect(database.statements[0]?.sql).toContain("queued_jobs = (SELECT COUNT(*) FROM scrape_jobs WHERE run_id = ? AND status IN ('queued', 'retrying'))");
    expect(database.statements[0]?.sql).toContain("failed_jobs = (SELECT COUNT(*) FROM scrape_jobs WHERE run_id = ? AND status = 'failed')");
    expect(database.statements[0]?.params.slice(0, 5)).toEqual(['run-1', 'run-1', 'run-1', 'run-1', 'run-1']);
    expect(database.statements[0]?.params.at(-1)).toBe('run-1');
  });

  it('reconciles scrape run status from tracked job states', async () => {
    const database = createRecordingDatabase();

    await reconcileScrapeRunStatus(database, 'run-1');

    expect(database.statements[0]?.sql).toContain("status = CASE");
    expect(database.statements[0]?.sql).toContain("status IN ('queued', 'running', 'retrying')");
    expect(database.statements[0]?.sql).toContain("THEN 'failed'");
    expect(database.statements[0]?.sql).toContain("ELSE 'completed'");
    expect(database.statements[0]?.params[0]).toBe('run-1');
    expect(database.statements[0]?.params.at(-1)).toBe('run-1');
  });

  it('lists recent scrape runs for operator status checks', async () => {
    const database = createRecordingDatabase();

    await listRecentScrapeRuns(database, 20);

    expect(database.statements[0]?.sql).toContain('FROM scrape_runs');
    expect(database.statements[0]?.sql).toContain('ORDER BY created_at DESC');
    expect(database.statements[0]?.params).toEqual([20]);
  });

  it('lists scrape jobs for a run for operator drill-downs', async () => {
    const database = createRecordingDatabase();

    await listScrapeJobsForRun(database, 'run-1', 100);

    expect(database.statements[0]?.sql).toContain('FROM scrape_jobs');
    expect(database.statements[0]?.sql).toContain('WHERE run_id = ?');
    expect(database.statements[0]?.params).toEqual(['run-1', 100]);
  });
});

function createRecordingDatabase() {
  const statements: Array<{ sql: string; params: unknown[] }> = [];

  return {
    statements,
    prepare(sql: string) {
      return {
        bind(...params: unknown[]) {
          statements.push({ sql, params });
          return this;
        },
        run: vi.fn(async () => ({ success: true }) as D1Result<unknown>),
        all: vi.fn(async () => ({ results: [] }) as D1Result<unknown>),
      } as unknown as D1PreparedStatement;
    },
  } as D1Database & { statements: Array<{ sql: string; params: unknown[] }> };
}
