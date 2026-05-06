import { Hono } from 'hono';
import {
  getEffectiveSeverity,
  getEffectiveVerdict,
  getSkillBySourceAndSlug,
  isServableInMode,
  listClawhubSkills,
  parseSkillMetadata,
  searchSkills,
  type SkillRow,
} from '../lib/d1';
import { buildPublicBadgeUrl, buildPublicReportUrl } from '../lib/public';
import type { WorkerBindings } from '../types';

const MODE = 'compliance' as const;

// ---------------------------------------------------------------------------
// Enterprise ClawHub-compatible routes
// ---------------------------------------------------------------------------

export const enterpriseClawhubRoutes = new Hono<{ Bindings: WorkerBindings }>();

enterpriseClawhubRoutes.get('/skills', async (c) => {
  const requestedLimit = Number.parseInt(c.req.query('limit') ?? '25', 10);
  const limit = Number.isNaN(requestedLimit) ? 25 : Math.min(Math.max(requestedLimit, 1), 100);
  const requestedCursor = Number.parseInt(c.req.query('cursor') ?? '0', 10);
  const offset = Number.isNaN(requestedCursor) ? 0 : Math.max(requestedCursor, 0);
  const query = c.req.query('q')?.trim();

  const results = await listClawhubSkills(c.env.DB, {
    limit,
    offset,
    query: query && query.length > 0 ? query : undefined,
  });

  const filtered = results.filter((row) => isServableInMode(row, MODE));

  return c.json({
    skills: filtered.map((row) => ({
      slug: row.slug,
      name: row.name,
      description: row.description,
      author: row.author,
      latestVersion: row.latest_version,
      verdict: getEffectiveVerdict(row, MODE),
      installs: row.installs ?? 0,
    })),
    nextCursor: results.length === limit ? String(offset + limit) : undefined,
  });
});

enterpriseClawhubRoutes.get('/skills/:slug', async (c) => {
  const { slug } = c.req.param();
  const skill = await getSkillBySourceAndSlug(c.env.DB, 'clawhub', slug);

  if (!skill) {
    return c.json({ error: 'not_found' }, 404);
  }

  const effectiveVerdict = getEffectiveVerdict(skill, MODE);

  if (!isServableInMode(skill, MODE)) {
    return c.json(
      {
        error: 'skill_blocked',
        message: `Skill "${slug}" does not meet enterprise compliance requirements.`,
        verdict: effectiveVerdict,
        severity: getEffectiveSeverity(skill, MODE),
        report: buildPublicReportUrl('clawhub', slug),
      },
      403,
    );
  }

  return c.json({
    slug: skill.slug,
    name: skill.name,
    description: skill.description,
    author: skill.author,
    latestVersion: skill.latest_scanned_version ?? skill.latest_version,
    verdict: effectiveVerdict,
    installs: skill.installs ?? 0,
  });
});

enterpriseClawhubRoutes.get('/download', async (c) => {
  const slug = c.req.query('slug');
  if (!slug) {
    return c.json({ error: 'slug required' }, 400);
  }

  const skill = await getSkillBySourceAndSlug(c.env.DB, 'clawhub', slug);

  if (!skill || getEffectiveVerdict(skill, MODE) === 'pending') {
    return c.json(
      {
        error: 'not_found',
        message: 'Skill not found or not yet scanned.',
        report: buildPublicReportUrl('clawhub', slug),
      },
      404,
    );
  }

  if (!isServableInMode(skill, MODE)) {
    return c.json(
      {
        error: 'skill_blocked',
        message: 'Blocked by enterprise compliance policy. See report.',
        report: buildPublicReportUrl('clawhub', slug),
      },
      403,
    );
  }

  if (!skill.r2_key) {
    return c.json({ error: 'asset_not_found' }, 404);
  }

  const object = await c.env.SKILLS_BUCKET.get(skill.r2_key);
  if (!object) {
    return c.json({ error: 'asset_not_found' }, 404);
  }

  return new Response(object.body, {
    headers: {
      'Content-Type': 'application/zip',
      'Content-Disposition': `attachment; filename="${slug}.zip"`,
      'Cache-Control': 'public, max-age=3600',
      'X-SkillShield-Verdict': getEffectiveVerdict(skill, MODE),
    },
  });
});

// ---------------------------------------------------------------------------
// Enterprise skills.sh-compatible routes
// ---------------------------------------------------------------------------

export const enterpriseSkillsRoutes = new Hono<{ Bindings: WorkerBindings }>();

enterpriseSkillsRoutes.get('/:owner/:repo/:skill/dl', async (c) => {
  const slug = `${c.req.param('owner')}/${c.req.param('repo')}/${c.req.param('skill')}`;
  const skill = await getSkillBySourceAndSlug(c.env.DB, 'skills-sh', slug);

  if (!skill || getEffectiveVerdict(skill, MODE) === 'pending') {
    return c.json(
      {
        error: 'not_found',
        message: 'Skill not found or not yet scanned.',
        report: buildPublicReportUrl('skills-sh', slug),
      },
      404,
    );
  }

  if (!isServableInMode(skill, MODE)) {
    return c.json(
      {
        error: 'skill_blocked',
        message: 'Blocked by enterprise compliance policy. See report.',
        report: buildPublicReportUrl('skills-sh', slug),
      },
      403,
    );
  }

  if (!skill.r2_key) {
    return c.json({ error: 'asset_not_found' }, 404);
  }

  const object = await c.env.SKILLS_BUCKET.get(skill.r2_key);
  if (!object) {
    return c.json({ error: 'asset_not_found' }, 404);
  }

  return new Response(object.body, {
    headers: {
      'Content-Type': 'application/gzip',
      'Content-Disposition': `attachment; filename="${c.req.param('skill')}.tar.gz"`,
      'Cache-Control': 'public, max-age=3600',
      'X-SkillShield-Verdict': getEffectiveVerdict(skill, MODE),
    },
  });
});

enterpriseSkillsRoutes.get('/:owner/:repo/:skill', async (c) => {
  const owner = c.req.param('owner');
  const repo = c.req.param('repo');
  const skillName = c.req.param('skill');
  const slug = `${owner}/${repo}/${skillName}`;
  const skill = await getSkillBySourceAndSlug(c.env.DB, 'skills-sh', slug);

  if (!skill || getEffectiveVerdict(skill, MODE) === 'pending') {
    return c.json({ error: 'not_found' }, 404);
  }

  if (!isServableInMode(skill, MODE)) {
    return c.json(
      {
        error: 'skill_blocked',
        message: `Skill "${slug}" does not meet enterprise compliance requirements.`,
        verdict: getEffectiveVerdict(skill, MODE),
        severity: getEffectiveSeverity(skill, MODE),
        report: buildPublicReportUrl('skills-sh', slug),
      },
      403,
    );
  }

  const metadata = parseSkillMetadata(skill.metadata);
  const version = skill.latest_scanned_version ?? skill.latest_version;

  return c.json({
    source: 'skills-sh',
    owner,
    repo,
    skill: skillName,
    slug,
    name: skill.name,
    description: skill.description,
    author: skill.author,
    version,
    verdict: getEffectiveVerdict(skill, MODE),
    severity: getEffectiveSeverity(skill, MODE),
    findings: skill.findings_count ?? 0,
    scanned_at: skill.last_scanned_at,
    report: buildPublicReportUrl('skills-sh', slug),
    badge: buildPublicBadgeUrl('skills-sh', slug),
    download: `/enterprise/skills/${slug}/dl`,
    metadata,
  });
});

// ---------------------------------------------------------------------------
// Enterprise skills.sh-compatible search
// ---------------------------------------------------------------------------

export const enterpriseSearchRoutes = new Hono<{ Bindings: WorkerBindings }>();

enterpriseSearchRoutes.get('/search', async (c) => {
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
    .filter((row) => isServableInMode(row, MODE))
    .slice(0, limit)
    .map((row) => {
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
    });

  return c.json({ skills });
});
