import { Hono } from 'hono';
import type { Context } from 'hono';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { queuedScanJobSchema } from '@skillshield/shared';
import { hasWebhookSecret } from '../lib/auth';
import { listSkillsShSlugsForRepository } from '../lib/d1';
import type { WorkerBindings } from '../types';

export const webhookRoutes = new Hono<{ Bindings: WorkerBindings }>();

type ClawhubEmbedField = {
  name?: unknown;
  value?: unknown;
};

type ClawhubWebhookPayload = {
  embeds?: Array<{
    url?: unknown;
    fields?: ClawhubEmbedField[];
  }>;
};

type GitHubWebhookPayload = {
  deleted?: unknown;
  ref?: unknown;
  repository?: {
    full_name?: unknown;
  };
  release?: {
    tag_name?: unknown;
  };
};

webhookRoutes.post('/clawhub', async (c) => {
  if (!isAuthorizedWebhookRequest(c)) {
    return c.json({ error: 'unauthorized' }, 401);
  }

  const rawBody = await c.req.text();
  let payload: ClawhubWebhookPayload;

  try {
    payload = JSON.parse(rawBody) as ClawhubWebhookPayload;
  } catch {
    return c.json({ error: 'invalid_json' }, 400);
  }

  const embed = payload.embeds?.[0];
  if (!embed || typeof embed !== 'object') {
    return c.json({ error: 'invalid_payload' }, 400);
  }

  const slug = parseClawhubSlug(embed.url);
  if (!slug) {
    return c.json({ error: 'cannot_parse_slug' }, 400);
  }

  const eventId = crypto.randomUUID();
  const createdAt = new Date().toISOString();
  const version = normalizeVersion(readEmbedField(embed.fields, 'Version'));
  const owner = readEmbedField(embed.fields, 'Owner');

  await c.env.DB.prepare(
    [
      'INSERT INTO webhook_events (id, source, event_type, payload, created_at)',
      "VALUES (?, 'clawhub', 'skill.publish', ?, ?)",
    ].join(' '),
  )
    .bind(eventId, rawBody, createdAt)
    .run();

  await c.env.SCAN_QUEUE.send(queuedScanJobSchema.parse({
    type: 'scan',
    source: 'clawhub',
    slug,
    version,
    owner,
    triggered_by: 'webhook',
    event_id: eventId,
  }));

  return c.json({ queued: true, event_id: eventId }, 202);
});

webhookRoutes.post('/github', async (c) => {
  const rawBody = await c.req.text();

  if (!isAuthorizedGitHubWebhookRequest(c, rawBody)) {
    return c.json({ error: 'unauthorized' }, 401);
  }

  let payload: GitHubWebhookPayload;

  try {
    payload = JSON.parse(rawBody) as GitHubWebhookPayload;
  } catch {
    return c.json({ error: 'invalid_json' }, 400);
  }

  const eventType = normalizeGitHubEventType(c.req.header('X-GitHub-Event'));
  if (!eventType) {
    return c.json({ skipped: true, reason: 'irrelevant_event' }, 200);
  }

  const repository = readGitHubRepository(payload);
  if (!repository) {
    return c.json({ error: 'no_repo' }, 400);
  }

  const version = readGitHubVersion(eventType, payload);
  if (!version) {
    return c.json({ error: 'missing_ref' }, 400);
  }

  const eventId = crypto.randomUUID();
  const createdAt = new Date().toISOString();

  await c.env.DB.prepare(
    [
      'INSERT INTO webhook_events (id, source, event_type, payload, created_at)',
      "VALUES (?, 'skills-sh', ?, ?, ?)",
    ].join(' '),
  )
    .bind(eventId, eventType, rawBody, createdAt)
    .run();

  if (eventType === 'push' && payload.deleted === true) {
    return c.json({ skipped: true, reason: 'deleted_ref', event_id: eventId }, 200);
  }

  const skillSlugs = await listSkillsShSlugsForRepository(c.env.DB, repository);
  if (skillSlugs.length === 0) {
    return c.json({ skipped: true, reason: 'repo_not_indexed', event_id: eventId }, 200);
  }

  await Promise.all(
    skillSlugs.map((slug) =>
      c.env.SCAN_QUEUE.send(queuedScanJobSchema.parse({
        type: 'scan',
        source: 'skills-sh',
        slug,
        repo: repository,
        version,
        triggered_by: 'github_webhook',
        event_id: eventId,
      })),
    ),
  );

  return c.json({
    queued: true,
    event_id: eventId,
    queued_jobs: skillSlugs.length,
    slugs: skillSlugs,
  }, 202);
});

function isAuthorizedWebhookRequest(c: Context<{ Bindings: WorkerBindings }>) {
  if (!hasWebhookSecret(c)) {
    return true;
  }

  const authorizationHeader = c.req.header('Authorization');
  if (authorizationHeader === `Bearer ${c.env.WEBHOOK_SECRET}`) {
    return true;
  }

  return c.req.header('X-Webhook-Secret') === c.env.WEBHOOK_SECRET;
}

function isAuthorizedGitHubWebhookRequest(c: Context<{ Bindings: WorkerBindings }>, rawBody: string) {
  if (!hasWebhookSecret(c)) {
    return true;
  }

  const secret = c.env.WEBHOOK_SECRET;
  if (!secret) {
    return true;
  }

  const signatureHeader = c.req.header('X-Hub-Signature-256');
  if (!signatureHeader || !signatureHeader.startsWith('sha256=')) {
    return false;
  }

  const expectedSignature = `sha256=${createHmac('sha256', secret).update(rawBody).digest('hex')}`;

  return timingSafeEquals(signatureHeader, expectedSignature);
}

function readEmbedField(fields: ClawhubEmbedField[] | undefined, fieldName: string) {
  const field = fields?.find((entry) => entry?.name === fieldName);
  return typeof field?.value === 'string' && field.value.trim().length > 0 ? field.value.trim() : undefined;
}

function normalizeVersion(version: string | undefined) {
  if (!version) {
    return undefined;
  }

  return version.replace(/^v/i, '');
}

function parseClawhubSlug(value: unknown) {
  if (typeof value !== 'string' || value.length === 0) {
    return undefined;
  }

  try {
    const url = new URL(value);
    const pathSegments = url.pathname.split('/').filter(Boolean);
    const slugSegments = pathSegments[0] === 'skills' ? pathSegments.slice(1) : pathSegments;

    if (slugSegments.length === 0) {
      return undefined;
    }

    return slugSegments.join('/');
  } catch {
    return undefined;
  }
}

function normalizeGitHubEventType(value: string | undefined) {
  if (value === 'push' || value === 'release') {
    return value;
  }

  return undefined;
}

function readGitHubRepository(payload: GitHubWebhookPayload) {
  const repository = payload.repository?.full_name;
  return typeof repository === 'string' && repository.trim().length > 0 ? repository.trim() : undefined;
}

function readGitHubVersion(eventType: 'push' | 'release', payload: GitHubWebhookPayload) {
  if (eventType === 'release') {
    const tagName = payload.release?.tag_name;
    return typeof tagName === 'string' && tagName.trim().length > 0 ? tagName.trim() : undefined;
  }

  const ref = payload.ref;
  if (typeof ref !== 'string' || ref.trim().length === 0) {
    return undefined;
  }

  return normalizeGitHubRef(ref.trim());
}

function normalizeGitHubRef(ref: string) {
  if (ref.startsWith('refs/heads/')) {
    return ref.slice('refs/heads/'.length);
  }

  if (ref.startsWith('refs/tags/')) {
    return ref.slice('refs/tags/'.length);
  }

  return ref;
}

function timingSafeEquals(left: string, right: string) {
  const leftBuffer = new TextEncoder().encode(left);
  const rightBuffer = new TextEncoder().encode(right);

  if (leftBuffer.byteLength !== rightBuffer.byteLength) {
    return false;
  }

  return timingSafeEqual(leftBuffer, rightBuffer);
}
