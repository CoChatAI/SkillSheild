import { Hono } from 'hono';
import type { Context } from 'hono';
import { getSkillBySourceAndSlug } from '../lib/d1';
import type { WorkerBindings } from '../types';

export const badgeRoutes = new Hono<{ Bindings: WorkerBindings }>();

const BADGE_COLORS = {
  verified: '#22c55e',
  caution: '#f59e0b',
  blocked: '#ef4444',
  pending: '#6b7280',
} as const;

function renderBadge(verdict: string) {
  const safeVerdict = verdict in BADGE_COLORS ? (verdict as keyof typeof BADGE_COLORS) : 'pending';
  const leftWidth = 80;
  const rightWidth = safeVerdict === 'verified' ? 70 : 65;
  const totalWidth = leftWidth + rightWidth;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${totalWidth}" height="20" role="img" aria-label="SkillShield: ${safeVerdict}"><linearGradient id="smooth" x2="0" y2="100%"><stop offset="0" stop-color="#fff" stop-opacity=".7"/><stop offset="1" stop-opacity=".1"/></linearGradient><clipPath id="round"><rect width="${totalWidth}" height="20" rx="3"/></clipPath><g clip-path="url(#round)"><rect width="${leftWidth}" height="20" fill="#4b5563"/><rect x="${leftWidth}" width="${rightWidth}" height="20" fill="${BADGE_COLORS[safeVerdict]}"/><rect width="${totalWidth}" height="20" fill="url(#smooth)"/></g><g fill="#fff" text-anchor="middle" font-family="Verdana,Geneva,DejaVu Sans,sans-serif" font-size="11"><text x="40" y="14">SkillShield</text><text x="${leftWidth + rightWidth / 2}" y="14">${safeVerdict}</text></g></svg>`;
}

async function serveBadge(
  c: Context<{ Bindings: WorkerBindings }>,
  source: 'clawhub' | 'skills-sh',
  slug: string,
) {
  const skill = await getSkillBySourceAndSlug(c.env.DB, source, slug);
  const svg = renderBadge(skill?.verdict ?? 'pending');

  return new Response(svg, {
    headers: {
      'Content-Type': 'image/svg+xml; charset=utf-8',
      'Cache-Control': 'public, max-age=300',
    },
  });
}

badgeRoutes.get('/clawhub/:slug', async (c) => {
  const slug = stripExpectedSuffix(c.req.param('slug'), '.svg');
  return serveBadge(c, 'clawhub', slug);
});

badgeRoutes.get('/skills/:owner/:repo/:skill', async (c) => {
  const owner = c.req.param('owner');
  const repo = c.req.param('repo');
  const skill = stripExpectedSuffix(c.req.param('skill'), '.svg');
  return serveBadge(c, 'skills-sh', `${owner}/${repo}/${skill}`);
});

function stripExpectedSuffix(value: string, suffix: string) {
  return value.endsWith(suffix) ? value.slice(0, -suffix.length) : value;
}
