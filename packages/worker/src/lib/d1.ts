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

export function getDatabaseHealthLabel(): string {
  return 'configured';
}

export function isServableVerdict(verdict: string | null | undefined) {
  return verdict !== null && verdict !== undefined && SERVABLE_VERDICTS.has(verdict);
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
