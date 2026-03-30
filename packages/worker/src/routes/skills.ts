import { Hono } from 'hono';
import { getSkillBySourceAndSlug, isServableVerdict, parseSkillMetadata } from '../lib/d1';
import { buildPublicBadgeUrl, buildPublicReportUrl } from '../lib/public';
import type { WorkerBindings } from '../types';

export const skillsRoutes = new Hono<{ Bindings: WorkerBindings }>();

skillsRoutes.get('/:owner/:repo/:skill/dl', async (c) => {
  const slug = buildSkillsShSlug(c.req.param('owner'), c.req.param('repo'), c.req.param('skill'));
  const skill = await getSkillBySourceAndSlug(c.env.DB, 'skills-sh', slug);

  if (!skill || skill.verdict === 'pending') {
    return c.json(
      {
        error: 'not_found',
        message: 'Skill not found or not yet scanned.',
        report: buildPublicReportUrl('skills-sh', slug),
      },
      404,
    );
  }

  if (skill.verdict === 'blocked') {
    return c.json(
      {
        error: 'skill_blocked',
        message: 'Blocked due to security findings. See report.',
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
      'X-SkillShield-Verdict': skill.verdict,
    },
  });
});

skillsRoutes.get('/:owner/:repo/:skill', async (c) => {
  const owner = c.req.param('owner');
  const repo = c.req.param('repo');
  const skillName = c.req.param('skill');
  const slug = buildSkillsShSlug(owner, repo, skillName);
  const skill = await getSkillBySourceAndSlug(c.env.DB, 'skills-sh', slug);

  if (!skill || skill.verdict === 'pending') {
    return c.json({ error: 'not_found' }, 404);
  }

  if (!isServableVerdict(skill.verdict)) {
    return c.json(
      {
        error: 'skill_blocked',
        message: `Skill "${slug}" was blocked by SkillShield due to ${skill.scan_severity ?? 'high'} severity security findings.`,
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
    verdict: skill.verdict,
    severity: skill.scan_severity,
    findings: skill.findings_count ?? 0,
    scanned_at: skill.last_scanned_at,
    report: buildPublicReportUrl('skills-sh', slug),
    badge: buildPublicBadgeUrl('skills-sh', slug),
    download: `/skills/${slug}/dl`,
    metadata,
  });
});

function buildSkillsShSlug(owner: string, repo: string, skill: string) {
  return `${owner}/${repo}/${skill}`;
}
