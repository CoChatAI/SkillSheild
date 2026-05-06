const SERVABLE_VERDICTS = new Set(['verified', 'caution']);

export type SkillRow = {
  id: string;
  source: string;
  slug: string;
  name: string;
  description: string | null;
  author: string | null;
  category: string | null;
  latest_version: string | null;
  latest_scanned_version: string | null;
  verdict: string;
  scan_severity: string | null;
  findings_count: number | null;
  installs: number | null;
  installs_updated_at: string | null;
  first_seen_at: string | null;
  last_scanned_at: string | null;
  last_updated_at: string | null;
  r2_key: string | null;
  report_r2_key: string | null;
  metadata: string | null;
  compliance_verdict: string | null;
  compliance_severity: string | null;
};

export type ScanRunRow = {
  version: string;
  verdict: string | null;
  severity: string | null;
};

export type SkillListQuery = {
  limit: number;
  offset: number;
  query?: string;
};

export type SkillSearchSort = 'installs:desc' | 'recent' | 'name:asc';

const SUPPORTED_SORTS: readonly SkillSearchSort[] = ['installs:desc', 'recent', 'name:asc'];

export function parseSkillSearchSort(value: string | undefined | null): SkillSearchSort {
  if (!value) {
    return 'installs:desc';
  }

  const normalized = value.trim().toLowerCase();
  return (SUPPORTED_SORTS as readonly string[]).includes(normalized)
    ? (normalized as SkillSearchSort)
    : 'installs:desc';
}

export type UnifiedSearchQuery = SkillListQuery & {
  source?: string;
  verdict?: string;
  category?: string;
  sort?: SkillSearchSort;
};

export type ScrapeTrackingStatus = 'queued' | 'running' | 'completed' | 'retrying' | 'failed';

export type ScrapeRunRow = {
  id: string;
  source: string;
  status: ScrapeTrackingStatus;
  total_jobs: number;
  queued_jobs: number;
  running_jobs: number;
  completed_jobs: number;
  failed_jobs: number;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
  error: string | null;
};

export type ScrapeJobRow = {
  id: string;
  run_id: string;
  source: string;
  slug: string;
  version: string;
  status: ScrapeTrackingStatus;
  attempts: number;
  queued_at: string;
  started_at: string | null;
  completed_at: string | null;
  updated_at: string;
  error: string | null;
};

export type CreateScrapeRunInput = {
  id: string;
  source: string;
  createdAt?: string;
  force?: boolean;
};

export type UpdateScrapeRunStatusInput = {
  id: string;
  status: ScrapeTrackingStatus;
  updatedAt?: string;
  completedAt?: string | null;
  error?: string | null;
};

export type UpsertScrapeJobInput = {
  id: string;
  runId: string;
  source: string;
  slug: string;
  version: string;
  queuedAt?: string;
  force?: boolean;
  recentScanMaxAgeHours?: number;
};

export type UpdateScrapeJobStatusInput = {
  runId: string;
  source: string;
  slug: string;
  version: string;
  status: ScrapeTrackingStatus;
  updatedAt?: string;
  startedAt?: string | null;
  completedAt?: string | null;
  error?: string | null;
  incrementAttempts?: boolean;
};

export function getDatabaseHealthLabel(): string {
  return 'configured';
}

export function isServableVerdict(verdict: string | null | undefined) {
  return verdict !== null && verdict !== undefined && SERVABLE_VERDICTS.has(verdict);
}

/**
 * For enterprise routes: use compliance_verdict instead of verdict.
 * Falls back to verdict if compliance_verdict is not yet populated.
 */
export function getEffectiveVerdict(row: SkillRow, mode: 'security' | 'compliance' = 'security') {
  if (mode === 'compliance') {
    return row.compliance_verdict ?? row.verdict;
  }
  return row.verdict;
}

export function getEffectiveSeverity(row: SkillRow, mode: 'security' | 'compliance' = 'security') {
  if (mode === 'compliance') {
    return row.compliance_severity ?? row.scan_severity;
  }
  return row.scan_severity;
}

export function isServableInMode(row: SkillRow, mode: 'security' | 'compliance' = 'security') {
  return isServableVerdict(getEffectiveVerdict(row, mode));
}

export function parseSkillMetadata(metadata: string | null | undefined): Record<string, unknown> {
  if (!metadata) {
    return {};
  }

  try {
    const parsed = JSON.parse(metadata) as unknown;

    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return {};
    }

    return parsed as Record<string, unknown>;
  } catch {
    return {};
  }
}

export async function createScrapeRun(db: D1Database, input: CreateScrapeRunInput) {
  const createdAt = input.createdAt ?? new Date().toISOString();

  await db
    .prepare(
      [
        'INSERT INTO scrape_runs (id, source, status, created_at, updated_at)',
        "VALUES (?, ?, 'queued', ?, ?)",
        'ON CONFLICT(id) DO UPDATE SET',
        '  updated_at = excluded.updated_at',
      ].join(' '),
    )
    .bind(input.id, input.source, createdAt, createdAt)
    .run();
}

export async function getActiveScrapeRun(db: D1Database, source: string) {
  return db
    .prepare(
      [
        'SELECT id, source, status, total_jobs, queued_jobs, running_jobs, completed_jobs, failed_jobs,',
        '       created_at, updated_at, completed_at, error',
        'FROM scrape_runs',
        "WHERE source = ? AND status IN ('queued', 'running')",
        'ORDER BY created_at DESC',
        'LIMIT 1',
      ].join(' '),
    )
    .bind(source)
    .first<ScrapeRunRow>();
}

export async function updateScrapeRunStatus(db: D1Database, input: UpdateScrapeRunStatusInput) {
  const updatedAt = input.updatedAt ?? new Date().toISOString();

  await db
    .prepare(
      [
        'UPDATE scrape_runs SET',
        '  status = ?,',
        '  updated_at = ?,',
        '  completed_at = ?,',
        '  error = ?',
        'WHERE id = ?',
      ].join(' '),
    )
    .bind(input.status, updatedAt, input.completedAt ?? null, input.error ?? null, input.id)
    .run();
}

export async function upsertScrapeJob(db: D1Database, input: UpsertScrapeJobInput) {
  const queuedAt = input.queuedAt ?? new Date().toISOString();

  await db
    .prepare(
      [
        'INSERT INTO scrape_jobs (id, run_id, source, slug, version, status, attempts, queued_at, updated_at)',
        "VALUES (?, ?, ?, ?, ?, 'queued', 0, ?, ?)",
        'ON CONFLICT(run_id, source, slug, version) DO UPDATE SET',
        '  updated_at = excluded.updated_at',
      ].join(' '),
    )
    .bind(input.id, input.runId, input.source, input.slug, input.version, queuedAt, queuedAt)
    .run();
}

export async function hasRecentCompletedScan(db: D1Database, input: {
  source: string;
  slug: string;
  version: string;
  since: string;
}) {
  const existingRun = await db
    .prepare(
      [
        'SELECT scan_runs.id',
        'FROM scan_runs',
        'INNER JOIN skills ON skills.id = scan_runs.skill_id',
        'WHERE skills.source = ? AND skills.slug = ?',
        "  AND scan_runs.status = 'completed'",
        '  AND scan_runs.version = ?',
        '  AND scan_runs.completed_at IS NOT NULL',
        '  AND scan_runs.completed_at >= ?',
        'LIMIT 1',
      ].join(' '),
    )
    .bind(input.source, input.slug, input.version, input.since)
    .first<{ id: string }>();

  return Boolean(existingRun);
}

export async function updateScrapeJobStatus(db: D1Database, input: UpdateScrapeJobStatusInput) {
  const updatedAt = input.updatedAt ?? new Date().toISOString();
  const attemptsSql = input.incrementAttempts ? 'attempts = attempts + 1,' : '';

  await db
    .prepare(
      [
        'UPDATE scrape_jobs SET',
        '  status = ?,',
        attemptsSql,
        '  started_at = COALESCE(?, started_at),',
        '  completed_at = ?,',
        '  updated_at = ?,',
        '  error = ?',
        'WHERE run_id = ? AND source = ? AND slug = ? AND version = ?',
      ].filter(Boolean).join(' '),
    )
    .bind(
      input.status,
      input.startedAt ?? null,
      input.completedAt ?? null,
      updatedAt,
      input.error ?? null,
      input.runId,
      input.source,
      input.slug,
      input.version,
    )
    .run();
}

export async function refreshScrapeRunCounters(db: D1Database, runId: string) {
  await db
    .prepare(
      [
        'UPDATE scrape_runs SET',
        '  total_jobs = (SELECT COUNT(*) FROM scrape_jobs WHERE run_id = ?),',
        "  queued_jobs = (SELECT COUNT(*) FROM scrape_jobs WHERE run_id = ? AND status IN ('queued', 'retrying')),",
        "  running_jobs = (SELECT COUNT(*) FROM scrape_jobs WHERE run_id = ? AND status = 'running'),",
        "  completed_jobs = (SELECT COUNT(*) FROM scrape_jobs WHERE run_id = ? AND status = 'completed'),",
        "  failed_jobs = (SELECT COUNT(*) FROM scrape_jobs WHERE run_id = ? AND status = 'failed'),",
        '  updated_at = ?',
        'WHERE id = ?',
      ].join(' '),
    )
    .bind(runId, runId, runId, runId, runId, new Date().toISOString(), runId)
    .run();
}

export async function reconcileScrapeRunStatus(db: D1Database, runId: string) {
  const now = new Date().toISOString();

  await db
    .prepare(
      [
        'UPDATE scrape_runs SET',
        '  status = CASE',
        "    WHEN EXISTS (SELECT 1 FROM scrape_jobs WHERE run_id = ? AND status IN ('queued', 'running', 'retrying')) THEN 'running'",
        "    WHEN EXISTS (SELECT 1 FROM scrape_jobs WHERE run_id = ? AND status = 'failed') THEN 'failed'",
        "    ELSE 'completed'",
        '  END,',
        "  completed_at = CASE WHEN NOT EXISTS (SELECT 1 FROM scrape_jobs WHERE run_id = ? AND status IN ('queued', 'running', 'retrying')) THEN ? ELSE NULL END,",
        "  error = CASE WHEN EXISTS (SELECT 1 FROM scrape_jobs WHERE run_id = ? AND status = 'failed') THEN COALESCE(error, 'One or more scrape jobs failed.') ELSE error END,",
        '  updated_at = ?',
        'WHERE id = ?',
      ].join(' '),
    )
    .bind(runId, runId, runId, now, runId, now, runId)
    .run();
}

export async function listRecentScrapeRuns(db: D1Database, limit: number) {
  const result = await db
    .prepare(
      [
        'SELECT id, source, status, total_jobs, queued_jobs, running_jobs, completed_jobs, failed_jobs,',
        '       created_at, updated_at, completed_at, error',
        'FROM scrape_runs',
        'ORDER BY created_at DESC',
        'LIMIT ?',
      ].join(' '),
    )
    .bind(limit)
    .all<ScrapeRunRow>();

  return result.results ?? [];
}

export async function listScrapeJobsForRun(db: D1Database, runId: string, limit: number) {
  const result = await db
    .prepare(
      [
        'SELECT id, run_id, source, slug, version, status, attempts, queued_at, started_at, completed_at, updated_at, error',
        'FROM scrape_jobs',
        'WHERE run_id = ?',
        'ORDER BY updated_at DESC',
        'LIMIT ?',
      ].join(' '),
    )
    .bind(runId, limit)
    .all<ScrapeJobRow>();

  return result.results ?? [];
}

export async function listQueuedScrapeJobsForRun(db: D1Database, runId: string, limit: number) {
  const result = await db
    .prepare(
      [
        'SELECT id, run_id, source, slug, version, status, attempts, queued_at, started_at, completed_at, updated_at, error',
        'FROM scrape_jobs',
        "WHERE run_id = ? AND status IN ('queued', 'retrying')",
        'ORDER BY updated_at ASC',
        'LIMIT ?',
      ].join(' '),
    )
    .bind(runId, limit)
    .all<ScrapeJobRow>();

  return result.results ?? [];
}

export async function listClawhubSkills(db: D1Database, input: SkillListQuery) {
  let sql = [
    'SELECT slug, name, description, author, latest_scanned_version as latest_version,',
    '       verdict, installs, metadata, last_updated_at',
    "FROM skills",
    "WHERE source = 'clawhub' AND verdict IN ('verified', 'caution')",
  ].join(' ');

  const params: Array<string | number> = [];

  if (input.query) {
    sql += ' AND (name LIKE ? OR description LIKE ? OR slug LIKE ?)';
    const likeQuery = `%${input.query}%`;
    params.push(likeQuery, likeQuery, likeQuery);
  }

  sql += ' ORDER BY installs DESC, last_updated_at DESC LIMIT ? OFFSET ?';
  params.push(input.limit, input.offset);

  const result = await db.prepare(sql).bind(...params).all<SkillRow>();
  return result.results ?? [];
}

export async function getClawhubSkill(db: D1Database, slug: string) {
  return db
    .prepare(
      "SELECT * FROM skills WHERE source = 'clawhub' AND slug = ? AND verdict IN ('verified', 'caution')",
    )
    .bind(slug)
    .first<SkillRow>();
}

export async function getClawhubSkillAnyVerdict(db: D1Database, slug: string) {
  return db
    .prepare('SELECT * FROM skills WHERE source = \'clawhub\' AND slug = ?')
    .bind(slug)
    .first<SkillRow>();
}

export async function getClawhubScanRun(db: D1Database, slug: string, version: string) {
  return db
    .prepare(
      [
        'SELECT scan_runs.version, scan_runs.verdict, scan_runs.severity',
        'FROM scan_runs',
        'INNER JOIN skills ON skills.id = scan_runs.skill_id',
        "WHERE skills.source = 'clawhub' AND skills.slug = ? AND scan_runs.version = ?",
      ].join(' '),
    )
    .bind(slug, version)
    .first<ScanRunRow>();
}

export async function searchSkills(db: D1Database, input: UnifiedSearchQuery) {
  let sql = 'SELECT * FROM skills WHERE 1 = 1';
  const params: Array<string | number> = [];

  if (input.query) {
    sql += ' AND (name LIKE ? OR description LIKE ? OR slug LIKE ?)';
    const likeQuery = `%${input.query}%`;
    params.push(likeQuery, likeQuery, likeQuery);
  }

  if (input.source) {
    sql += ' AND source = ?';
    params.push(input.source);
  }

  if (input.verdict) {
    sql += ' AND verdict = ?';
    params.push(input.verdict);
  }

  if (input.category) {
    sql += ' AND category = ?';
    params.push(input.category);
  }

  sql += ` ORDER BY ${buildSortClause(input.sort)} LIMIT ? OFFSET ?`;
  params.push(input.limit, input.offset);

  const result = await db.prepare(sql).bind(...params).all<SkillRow>();
  return result.results ?? [];
}

function buildSortClause(sort: SkillSearchSort | undefined): string {
  switch (sort) {
    case 'recent':
      return 'CASE WHEN last_scanned_at IS NULL THEN 1 ELSE 0 END, last_scanned_at DESC, last_updated_at DESC';
    case 'name:asc':
      return 'name COLLATE NOCASE ASC, slug ASC';
    case 'installs:desc':
    default:
      return 'installs DESC, last_updated_at DESC';
  }
}

export async function getSkillBySourceAndSlug(db: D1Database, source: string, slug: string) {
  return db.prepare('SELECT * FROM skills WHERE source = ? AND slug = ?').bind(source, slug).first<SkillRow>();
}

export async function listRecentSkills(db: D1Database, limit: number) {
  const result = await db
    .prepare(
      [
        'SELECT * FROM skills',
        'ORDER BY CASE WHEN last_scanned_at IS NULL THEN 1 ELSE 0 END,',
        '         last_scanned_at DESC,',
        '         last_updated_at DESC',
        'LIMIT ?',
      ].join(' '),
    )
    .bind(limit)
    .all<SkillRow>();

  return result.results ?? [];
}

export async function listSkillsShSlugsForRepository(db: D1Database, repository: string) {
  const result = await db
    .prepare(
      [
        'SELECT slug FROM skills',
        "WHERE source = 'skills-sh'",
        "  AND (json_extract(metadata, '$.repo') = ? OR slug LIKE ?)",
        'ORDER BY slug ASC',
      ].join(' '),
    )
    .bind(repository, `${repository}/%`)
    .all<Pick<SkillRow, 'slug'>>();

  return (result.results ?? [])
    .map((row) => row.slug)
    .filter((slug): slug is string => typeof slug === 'string' && slug.length > 0);
}
