import { Hono } from 'hono';
import { searchResponseSchema } from '@skillshield/shared';
import { getSkillBySourceAndSlug, listRecentSkills, parseSkillMetadata, searchSkills, type SkillRow } from '../lib/d1';
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

  const results = await searchSkills(c.env.DB, {
    limit,
    offset,
    query: query && query.length > 0 ? query : undefined,
    source: source && source.length > 0 ? source : undefined,
    verdict: verdict && verdict.length > 0 ? verdict : undefined,
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

function buildSearchSkillRecord(row: SkillRow) {
  return {
    id: row.id,
    source: row.source,
    slug: row.slug,
    name: row.name,
    description: row.description,
    author: row.author,
    latestVersion: row.latest_version,
    latestScannedVersion: row.latest_scanned_version,
    verdict: row.verdict,
    scanSeverity: row.scan_severity,
    findingsCount: row.findings_count ?? 0,
    installs: row.installs ?? 0,
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
