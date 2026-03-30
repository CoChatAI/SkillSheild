import { Hono } from 'hono';
import type { Context } from 'hono';
import {
  getClawhubScanRun,
  getClawhubSkill,
  getClawhubSkillAnyVerdict,
  isServableVerdict,
  listClawhubSkills,
  parseSkillMetadata,
  type SkillRow,
} from '../lib/d1';
import type { WorkerBindings } from '../types';

export const clawhubRoutes = new Hono<{ Bindings: WorkerBindings }>();

clawhubRoutes.get('/skills', async (c) => {
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

  return c.json({
    skills: results.map((row) => buildClawhubSkillPayload(row, row.latest_version ?? undefined)),
    nextCursor: results.length === limit ? String(offset + limit) : undefined,
  });
});

clawhubRoutes.get('/skills/:slug/:version', async (c) => {
  const { slug, version } = c.req.param();
  const skill = await getClawhubSkill(c.env.DB, slug);

  if (!skill) {
    return getBlockedOrMissingSkillResponse(c, slug);
  }

  const scanRun = await getClawhubScanRun(c.env.DB, slug, version);

  if (!scanRun) {
    return c.json({ error: 'not_found' }, 404);
  }

  if (!isServableVerdict(scanRun.verdict)) {
    if (scanRun.verdict === 'blocked') {
      return c.json(
        {
          error: 'skill_blocked',
          message: `Skill "${slug}" was blocked by SkillShield due to ${scanRun.severity ?? 'high'} severity security findings.`,
          report: buildClawhubReportUrl(slug),
        },
        403,
      );
    }

    return c.json({ error: 'not_found' }, 404);
  }

  return c.json(buildClawhubSkillPayload(skill, version));
});

clawhubRoutes.get('/skills/:slug', async (c) => {
  const { slug } = c.req.param();
  const skill = await getClawhubSkill(c.env.DB, slug);

  if (!skill) {
    return getBlockedOrMissingSkillResponse(c, slug);
  }

  return c.json(buildClawhubSkillPayload(skill, skill.latest_scanned_version ?? undefined));
});

clawhubRoutes.get('/download', async (c) => {
  const slug = c.req.query('slug');
  const version = c.req.query('version');

  if (!slug) {
    return c.json({ error: 'slug required' }, 400);
  }

  const skill = await getClawhubSkillAnyVerdict(c.env.DB, slug);

  if (!skill || skill.verdict === 'pending') {
    return c.json(
      {
        error: 'not_found',
        message: 'Skill not found or not yet scanned.',
        report: buildClawhubReportUrl(slug),
      },
      404,
    );
  }

  if (skill.verdict === 'blocked') {
    return c.json(
      {
        error: 'skill_blocked',
        message: 'Blocked due to security findings. See report.',
        report: buildClawhubReportUrl(slug),
      },
      403,
    );
  }

  const r2Key = version ? `clawhub/${slug}/${version}.zip` : skill.r2_key;
  if (!r2Key) {
    return c.json({ error: 'asset_not_found' }, 404);
  }

  const object = await c.env.SKILLS_BUCKET.get(r2Key);

  if (!object) {
    return c.json({ error: 'asset_not_found' }, 404);
  }

  return new Response(object.body, {
    headers: {
      'Content-Type': 'application/zip',
      'Content-Disposition': `attachment; filename="${slug}.zip"`,
      'Cache-Control': 'public, max-age=3600',
      'X-SkillShield-Verdict': skill.verdict,
    },
  });
});

function buildClawhubSkillPayload(skill: SkillRow, versionOverride?: string) {
  const metadata = parseSkillMetadata(skill.metadata);

  return {
    slug: skill.slug,
    name: skill.name,
    description: skill.description,
    author: skill.author,
    versions: { latest: versionOverride ?? skill.latest_scanned_version ?? skill.latest_version },
    installs: skill.installs ?? 0,
    ...metadata,
  };
}

async function getBlockedOrMissingSkillResponse(
  c: Context<{ Bindings: WorkerBindings }>,
  slug: string,
) {
  const blocked = await getClawhubSkillAnyVerdict(c.env.DB, slug);

  if (blocked && blocked.verdict === 'blocked') {
    return c.json(
      {
        error: 'skill_blocked',
        message: `Skill "${slug}" was blocked by SkillShield due to ${blocked.scan_severity ?? 'high'} severity security findings.`,
        report: buildClawhubReportUrl(slug),
      },
      403,
    );
  }

  return c.json({ error: 'not_found' }, 404);
}

function buildClawhubReportUrl(slug: string) {
  return `https://skillshield.cochat.ai/reports/clawhub/${slug}.json`;
}
