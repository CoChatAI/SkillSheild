import { createHmac } from 'node:crypto';
import { queuedScanJobSchema, type QueuedScanJob } from '@skillshield/shared';
import { describe, expect, it } from 'vitest';
import app from '../src/index';
import type { WorkerBindings } from '../src/types';

type PersistedWebhookEvent = {
  id: string;
  source: string;
  eventType: string;
  payload: string;
  createdAt: string;
};

describe('webhook routes', () => {
  it('persists and queues a ClawHub publish event', async () => {
    const persistedEvents: PersistedWebhookEvent[] = [];
    const queuedJobs: QueuedScanJob[] = [];
    const env = createEnv({ persistedEvents, queuedJobs, webhookSecret: 'top-secret' });
    const payload = {
      embeds: [
        {
          title: 'Skill published',
          url: 'https://clawhub.ai/acme/trello',
          fields: [
            { name: 'Version', value: 'v1.2.3' },
            { name: 'Owner', value: 'Acme' },
          ],
        },
      ],
    };

    const response = await app.request(
      'http://localhost/webhooks/clawhub',
      {
        method: 'POST',
        headers: {
          Authorization: 'Bearer top-secret',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      },
      env,
    );

    expect(response.status).toBe(202);

    const body = (await response.json()) as { queued: boolean; event_id: string };
    expect(body.queued).toBe(true);
    expect(body.event_id).toBeTruthy();

    expect(persistedEvents).toHaveLength(1);
    expect(persistedEvents[0]).toMatchObject({
      id: body.event_id,
      source: 'clawhub',
      eventType: 'skill.publish',
      payload: JSON.stringify(payload),
    });

    expect(queuedScanJobSchema.array().parse(queuedJobs)).toEqual([
      {
        type: 'scan',
        source: 'clawhub',
        slug: 'acme/trello',
        version: '1.2.3',
        owner: 'Acme',
        triggered_by: 'webhook',
        event_id: body.event_id,
      },
    ]);
  });

  it('queues GitHub push events for every indexed skill in the repo', async () => {
    const persistedEvents: PersistedWebhookEvent[] = [];
    const queuedJobs: QueuedScanJob[] = [];
    const payload = {
      ref: 'refs/heads/main',
      repository: {
        full_name: 'anthropics/skills',
      },
    };
    const rawBody = JSON.stringify(payload);
    const env = createEnv({
      persistedEvents,
      queuedJobs,
      webhookSecret: 'github-secret',
      skillsByRepository: {
        'anthropics/skills': [
          'anthropics/skills/frontend-design',
          'anthropics/skills/prompt-reviewer',
        ],
      },
    });

    const response = await app.request(
      'http://localhost/webhooks/github',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-GitHub-Event': 'push',
          'X-Hub-Signature-256': signGitHubPayload(rawBody, 'github-secret'),
        },
        body: rawBody,
      },
      env,
    );

    expect(response.status).toBe(202);

    const body = (await response.json()) as {
      queued: boolean;
      event_id: string;
      queued_jobs: number;
      slugs: string[];
    };
    expect(body).toEqual({
      queued: true,
      event_id: body.event_id,
      queued_jobs: 2,
      slugs: [
        'anthropics/skills/frontend-design',
        'anthropics/skills/prompt-reviewer',
      ],
    });

    expect(persistedEvents).toHaveLength(1);
    expect(persistedEvents[0]).toMatchObject({
      id: body.event_id,
      source: 'skills-sh',
      eventType: 'push',
      payload: rawBody,
    });

    expect(queuedScanJobSchema.array().parse(queuedJobs)).toEqual([
      {
        type: 'scan',
        source: 'skills-sh',
        slug: 'anthropics/skills/frontend-design',
        repo: 'anthropics/skills',
        version: 'main',
        triggered_by: 'github_webhook',
        event_id: body.event_id,
      },
      {
        type: 'scan',
        source: 'skills-sh',
        slug: 'anthropics/skills/prompt-reviewer',
        repo: 'anthropics/skills',
        version: 'main',
        triggered_by: 'github_webhook',
        event_id: body.event_id,
      },
    ]);
  });

  it('queues GitHub release events with the release tag', async () => {
    const queuedJobs: QueuedScanJob[] = [];
    const payload = {
      action: 'published',
      repository: {
        full_name: 'anthropics/skills',
      },
      release: {
        tag_name: 'v2.0.0',
      },
    };
    const rawBody = JSON.stringify(payload);
    const env = createEnv({
      queuedJobs,
      webhookSecret: 'github-secret',
      skillsByRepository: {
        'anthropics/skills': ['anthropics/skills/frontend-design'],
      },
    });

    const response = await app.request(
      'http://localhost/webhooks/github',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-GitHub-Event': 'release',
          'X-Hub-Signature-256': signGitHubPayload(rawBody, 'github-secret'),
        },
        body: rawBody,
      },
      env,
    );

    expect(response.status).toBe(202);
    expect(queuedScanJobSchema.array().parse(queuedJobs)).toEqual([
      expect.objectContaining({
        source: 'skills-sh',
        slug: 'anthropics/skills/frontend-design',
        repo: 'anthropics/skills',
        version: 'v2.0.0',
        triggered_by: 'github_webhook',
      }),
    ]);
  });

  it('skips unsupported GitHub event types', async () => {
    const response = await app.request(
      'http://localhost/webhooks/github',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-GitHub-Event': 'issues',
        },
        body: JSON.stringify({ repository: { full_name: 'anthropics/skills' } }),
      },
      createEnv(),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ skipped: true, reason: 'irrelevant_event' });
  });

  it('skips supported GitHub events when the repo has no indexed skills yet', async () => {
    const persistedEvents: PersistedWebhookEvent[] = [];
    const payload = {
      ref: 'refs/heads/main',
      repository: {
        full_name: 'new-owner/new-repo',
      },
    };
    const rawBody = JSON.stringify(payload);
    const env = createEnv({
      persistedEvents,
      webhookSecret: 'github-secret',
    });

    const response = await app.request(
      'http://localhost/webhooks/github',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-GitHub-Event': 'push',
          'X-Hub-Signature-256': signGitHubPayload(rawBody, 'github-secret'),
        },
        body: rawBody,
      },
      env,
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      skipped: true,
      reason: 'repo_not_indexed',
      event_id: persistedEvents[0]?.id,
    });
    expect(persistedEvents).toHaveLength(1);
  });

  it('rejects malformed GitHub webhook JSON', async () => {
    const response = await app.request(
      'http://localhost/webhooks/github',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-GitHub-Event': 'push',
        },
        body: '{bad json',
      },
      createEnv(),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: 'invalid_json' });
  });

  it('rejects GitHub payloads without a repository full name', async () => {
    const payload = {
      ref: 'refs/heads/main',
      repository: {},
    };
    const rawBody = JSON.stringify(payload);

    const response = await app.request(
      'http://localhost/webhooks/github',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-GitHub-Event': 'push',
          'X-Hub-Signature-256': signGitHubPayload(rawBody, 'github-secret'),
        },
        body: rawBody,
      },
      createEnv({ webhookSecret: 'github-secret' }),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: 'no_repo' });
  });
});

function createEnv(options: {
  persistedEvents?: PersistedWebhookEvent[];
  queuedJobs?: QueuedScanJob[];
  webhookSecret?: string;
  skillsByRepository?: Record<string, string[]>;
} = {}): WorkerBindings {
  const persistedEvents = options.persistedEvents ?? [];
  const queuedJobs = options.queuedJobs ?? [];
  const skillsByRepository = options.skillsByRepository ?? {};

  return {
    DB: createMockDatabase(persistedEvents, skillsByRepository),
    SKILLS_BUCKET: {} as R2Bucket,
    REPORTS_BUCKET: {} as R2Bucket,
    META_BUCKET: {} as R2Bucket,
    SCAN_QUEUE: {
      send: async (message: unknown) => {
        queuedJobs.push(message as QueuedScanJob);
      },
    } as Queue,
    WEBHOOK_SECRET: options.webhookSecret,
    ENVIRONMENT: 'test',
  };
}

function createMockDatabase(
  persistedEvents: PersistedWebhookEvent[],
  skillsByRepository: Record<string, string[]>,
): D1Database {
  return {
    prepare(sql: string) {
      return createStatement(sql, persistedEvents, skillsByRepository);
    },
  } as D1Database;
}

function createStatement(
  sql: string,
  persistedEvents: PersistedWebhookEvent[],
  skillsByRepository: Record<string, string[]>,
): D1PreparedStatement {
  const normalizedSql = normalizeSql(sql);
  let boundParams: unknown[] = [];

  return {
    bind(...params: unknown[]) {
      boundParams = params;
      return this;
    },
    async run() {
      if (
        normalizedSql ===
        "INSERT INTO webhook_events (id, source, event_type, payload, created_at) VALUES (?, 'clawhub', 'skill.publish', ?, ?)"
      ) {
        persistedEvents.push({
          id: String(boundParams[0]),
          source: 'clawhub',
          eventType: 'skill.publish',
          payload: String(boundParams[1]),
          createdAt: String(boundParams[2]),
        });

        return { success: true } as D1Result<unknown>;
      }

      if (
        normalizedSql
        === "INSERT INTO webhook_events (id, source, event_type, payload, created_at) VALUES (?, 'skills-sh', ?, ?, ?)"
      ) {
        persistedEvents.push({
          id: String(boundParams[0]),
          source: 'skills-sh',
          eventType: String(boundParams[1]),
          payload: String(boundParams[2]),
          createdAt: String(boundParams[3]),
        });

        return { success: true } as D1Result<unknown>;
      }

      throw new Error(`Unhandled run() query: ${normalizedSql}`);
    },
    async all<T>() {
      if (
        normalizedSql
        === "SELECT slug FROM skills WHERE source = 'skills-sh' AND (json_extract(metadata, '$.repo') = ? OR slug LIKE ?) ORDER BY slug ASC"
      ) {
        const repository = String(boundParams[0]);
        return {
          results: (skillsByRepository[repository] ?? []).map((slug) => ({ slug })) as T[],
          success: true,
        } as D1Result<T>;
      }

      throw new Error(`Unhandled all() query: ${normalizedSql}`);
    },
  } as D1PreparedStatement;
}

function normalizeSql(sql: string) {
  return sql.replace(/\s+/g, ' ').trim();
}

function signGitHubPayload(rawBody: string, secret: string) {
  return `sha256=${createHmac('sha256', secret).update(rawBody).digest('hex')}`;
}
