import { Hono } from 'hono';
import { buildReportStorageKey } from '../lib/public';
import type { WorkerBindings } from '../types';

export const reportsRoutes = new Hono<{ Bindings: WorkerBindings }>();

reportsRoutes.get('/clawhub/:slug', async (c) => {
  const slug = stripExpectedSuffix(c.req.param('slug'), '.json');
  const object = await c.env.REPORTS_BUCKET.get(buildReportStorageKey('clawhub', slug));

  if (!object) {
    return c.json({ error: 'no_report' }, 404);
  }

  return new Response(object.body, {
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'public, max-age=600',
    },
  });
});

reportsRoutes.get('/skills/:owner/:repo/:skill', async (c) => {
  const owner = c.req.param('owner');
  const repo = c.req.param('repo');
  const skill = stripExpectedSuffix(c.req.param('skill'), '.json');
  const slug = `${owner}/${repo}/${skill}`;
  const object = await c.env.REPORTS_BUCKET.get(buildReportStorageKey('skills-sh', slug));

  if (!object) {
    return c.json({ error: 'no_report' }, 404);
  }

  return new Response(object.body, {
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'public, max-age=600',
    },
  });
});

function stripExpectedSuffix(value: string, suffix: string) {
  return value.endsWith(suffix) ? value.slice(0, -suffix.length) : value;
}
