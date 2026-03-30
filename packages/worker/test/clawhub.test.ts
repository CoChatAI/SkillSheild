import { describe, expect, it } from 'vitest';
import app from '../src/index';
import type { WorkerBindings } from '../src/types';

type SkillFixture = {
  id: string;
  source: 'clawhub';
  slug: string;
  name: string;
  description: string | null;
  author: string | null;
  latest_version: string | null;
  latest_scanned_version: string | null;
  verdict: 'verified' | 'caution' | 'blocked' | 'pending';
  scan_severity: 'none' | 'low' | 'medium' | 'high' | 'critical' | null;
  installs: number;
  last_updated_at: string;
  r2_key: string | null;
  report_r2_key: string | null;
  metadata: string | null;
};

type ScanRunFixture = {
  skill_id: string;
  version: string;
  verdict: 'verified' | 'caution' | 'blocked' | 'pending';
  severity: 'none' | 'low' | 'medium' | 'high' | 'critical' | null;
};

const skills: SkillFixture[] = [
  {
    id: 'clawhub:trello',
    source: 'clawhub',
    slug: 'trello',
    name: 'Trello',
    description: 'Kanban helper',
    author: 'Acme',
    latest_version: '1.2.3',
    latest_scanned_version: '1.2.3',
    verdict: 'verified',
    scan_severity: 'none',
    installs: 100,
    last_updated_at: '2026-03-21T00:00:00.000Z',
    r2_key: 'clawhub/trello/latest.zip',
    report_r2_key: 'clawhub/trello.json',
    metadata: JSON.stringify({ tags: ['productivity'], category: 'workflow' }),
  },
  {
    id: 'clawhub:asana',
    source: 'clawhub',
    slug: 'asana',
    name: 'Asana',
    description: 'Project planner',
    author: 'Acme',
    latest_version: '2.0.0',
    latest_scanned_version: '2.0.0',
    verdict: 'caution',
    scan_severity: 'medium',
    installs: 75,
    last_updated_at: '2026-03-20T00:00:00.000Z',
    r2_key: 'clawhub/asana/latest.zip',
    report_r2_key: 'clawhub/asana.json',
    metadata: JSON.stringify({ tags: ['project-management'] }),
  },
  {
    id: 'clawhub:blocked-skill',
    source: 'clawhub',
    slug: 'blocked-skill',
    name: 'Blocked Skill',
    description: 'Unsafe',
    author: 'Acme',
    latest_version: '9.9.9',
    latest_scanned_version: '9.9.9',
    verdict: 'blocked',
    scan_severity: 'critical',
    installs: 5,
    last_updated_at: '2026-03-19T00:00:00.000Z',
    r2_key: null,
    report_r2_key: 'clawhub/blocked-skill.json',
    metadata: null,
  },
  {
    id: 'clawhub:pending-skill',
    source: 'clawhub',
    slug: 'pending-skill',
    name: 'Pending Skill',
    description: 'Still scanning',
    author: 'Acme',
    latest_version: '0.0.1',
    latest_scanned_version: null,
    verdict: 'pending',
    scan_severity: null,
    installs: 1,
    last_updated_at: '2026-03-18T00:00:00.000Z',
    r2_key: null,
    report_r2_key: 'clawhub/pending-skill.json',
    metadata: null,
  },
];

const scanRuns: ScanRunFixture[] = [
  {
    skill_id: 'clawhub:trello',
    version: '1.2.3',
    verdict: 'verified',
    severity: 'none',
  },
  {
    skill_id: 'clawhub:trello',
    version: '1.2.2',
    verdict: 'caution',
    severity: 'medium',
  },
  {
    skill_id: 'clawhub:blocked-skill',
    version: '9.9.9',
    verdict: 'blocked',
    severity: 'critical',
  },
];

const skillObjects = new Map<string, Uint8Array>([
  ['clawhub/trello/latest.zip', new Uint8Array([1, 2, 3])],
  ['clawhub/trello/1.2.2.zip', new Uint8Array([4, 5, 6])],
  ['clawhub/asana/latest.zip', new Uint8Array([7, 8, 9])],
]);

describe('clawhub worker routes', () => {
  it('lists only servable skills in the ClawHub response shape', async () => {
    const response = await app.request(
      'http://localhost/clawhub/api/v1/skills?limit=1&q=llo',
      {},
      createEnv(),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      skills: [
        {
          slug: 'trello',
          name: 'Trello',
          description: 'Kanban helper',
          author: 'Acme',
          versions: { latest: '1.2.3' },
          installs: 100,
          tags: ['productivity'],
          category: 'workflow',
        },
      ],
      nextCursor: '1',
    });
  });

  it('returns skill metadata for a servable skill', async () => {
    const response = await app.request('http://localhost/clawhub/api/v1/skills/trello', {}, createEnv());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      slug: 'trello',
      name: 'Trello',
      description: 'Kanban helper',
      author: 'Acme',
      versions: { latest: '1.2.3' },
      installs: 100,
      tags: ['productivity'],
      category: 'workflow',
    });
  });

  it('returns version-specific metadata when the scan run is servable', async () => {
    const response = await app.request('http://localhost/clawhub/api/v1/skills/trello/1.2.2', {}, createEnv());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      slug: 'trello',
      name: 'Trello',
      description: 'Kanban helper',
      author: 'Acme',
      versions: { latest: '1.2.2' },
      installs: 100,
      tags: ['productivity'],
      category: 'workflow',
    });
  });

  it('returns a blocked payload for blocked metadata requests', async () => {
    const response = await app.request(
      'http://localhost/clawhub/api/v1/skills/blocked-skill',
      {},
      createEnv(),
    );

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({
      error: 'skill_blocked',
      message: 'Skill "blocked-skill" was blocked by SkillShield due to critical severity security findings.',
      report: 'https://skillshield.cochat.ai/reports/clawhub/blocked-skill.json',
    });
  });

  it('returns not found for missing metadata requests', async () => {
    const response = await app.request('http://localhost/clawhub/api/v1/skills/missing-skill', {}, createEnv());

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({ error: 'not_found' });
  });

  it('downloads the latest ZIP and exposes SkillShield headers', async () => {
    const response = await app.request('http://localhost/clawhub/api/v1/download?slug=trello', {}, createEnv());

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('application/zip');
    expect(response.headers.get('content-disposition')).toBe('attachment; filename="trello.zip"');
    expect(response.headers.get('cache-control')).toBe('public, max-age=3600');
    expect(response.headers.get('x-skillshield-verdict')).toBe('verified');
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3]));
  });

  it('downloads a versioned ZIP when version is requested', async () => {
    const response = await app.request(
      'http://localhost/clawhub/api/v1/download?slug=trello&version=1.2.2',
      {},
      createEnv(),
    );

    expect(response.status).toBe(200);
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(new Uint8Array([4, 5, 6]));
  });

  it('returns blocked download details for blocked skills', async () => {
    const response = await app.request(
      'http://localhost/clawhub/api/v1/download?slug=blocked-skill',
      {},
      createEnv(),
    );

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({
      error: 'skill_blocked',
      message: 'Blocked due to security findings. See report.',
      report: 'https://skillshield.cochat.ai/reports/clawhub/blocked-skill.json',
    });
  });

  it('returns not found download details for missing skills', async () => {
    const response = await app.request('http://localhost/clawhub/api/v1/download?slug=missing-skill', {}, createEnv());

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({
      error: 'not_found',
      message: 'Skill not found or not yet scanned.',
      report: 'https://skillshield.cochat.ai/reports/clawhub/missing-skill.json',
    });
  });
});

function createEnv(): WorkerBindings {
  return {
    DB: createMockDatabase(),
    SKILLS_BUCKET: createMockSkillsBucket(),
    REPORTS_BUCKET: {} as R2Bucket,
    META_BUCKET: {} as R2Bucket,
    SCAN_QUEUE: {} as Queue,
    ENVIRONMENT: 'test',
  };
}

function createMockSkillsBucket(): R2Bucket {
  return {
    get: async (key: string) => {
      const object = skillObjects.get(key);

      if (!object) {
        return null;
      }

      return {
        body: object,
      } as unknown as R2ObjectBody;
    },
  } as R2Bucket;
}

function createMockDatabase(): D1Database {
  return {
    prepare(sql: string) {
      return createStatement(sql);
    },
  } as D1Database;
}

function createStatement(sql: string): D1PreparedStatement {
  const normalizedSql = normalizeSql(sql);
  let boundParams: unknown[] = [];

  return {
    bind(...params: unknown[]) {
      boundParams = params;
      return this;
    },
    async all() {
      return { results: executeAll(normalizedSql, boundParams) } as D1Result<unknown>;
    },
    async first() {
      return executeFirst(normalizedSql, boundParams);
    },
  } as D1PreparedStatement;
}

function executeAll(sql: string, params: unknown[]) {
  if (!sql.includes("FROM skills WHERE source = 'clawhub' AND verdict IN ('verified', 'caution')")) {
    throw new Error(`Unhandled all() query: ${sql}`);
  }

  const [firstParam, secondParam, thirdParam, limitParam, offsetParam] = params;
  const hasQuery = typeof thirdParam === 'string';
  const query = hasQuery && typeof firstParam === 'string' ? firstParam.slice(1, -1).toLowerCase() : null;
  const limit = Number(hasQuery ? limitParam : firstParam);
  const offset = Number(hasQuery ? offsetParam : secondParam);

  const filtered = skills
    .filter((skill) => skill.verdict === 'verified' || skill.verdict === 'caution')
    .filter((skill) => {
      if (!query) {
        return true;
      }

      return [skill.slug, skill.name, skill.description ?? '']
        .join(' ')
        .toLowerCase()
        .includes(query);
    })
    .sort((left, right) => right.installs - left.installs)
    .slice(offset, offset + limit)
    .map((skill) => ({
      slug: skill.slug,
      name: skill.name,
      description: skill.description,
      author: skill.author,
      latest_version: skill.latest_scanned_version,
      verdict: skill.verdict,
      installs: skill.installs,
      metadata: skill.metadata,
      last_updated_at: skill.last_updated_at,
    }));

  return filtered;
}

function executeFirst(sql: string, params: unknown[]) {
  if (sql === "SELECT * FROM skills WHERE source = 'clawhub' AND slug = ? AND verdict IN ('verified', 'caution')") {
    const slug = String(params[0]);
    return skills.find((skill) => skill.slug === slug && (skill.verdict === 'verified' || skill.verdict === 'caution')) ?? null;
  }

  if (sql === "SELECT * FROM skills WHERE source = 'clawhub' AND slug = ?") {
    const slug = String(params[0]);
    return skills.find((skill) => skill.slug === slug) ?? null;
  }

  if (
    sql ===
    "SELECT scan_runs.version, scan_runs.verdict, scan_runs.severity FROM scan_runs INNER JOIN skills ON skills.id = scan_runs.skill_id WHERE skills.source = 'clawhub' AND skills.slug = ? AND scan_runs.version = ?"
  ) {
    const slug = String(params[0]);
    const version = String(params[1]);
    const skill = skills.find((entry) => entry.slug === slug);

    if (!skill) {
      return null;
    }

    return (
      scanRuns.find((scanRun) => scanRun.skill_id === skill.id && scanRun.version === version) ?? null
    );
  }

  throw new Error(`Unhandled first() query: ${sql}`);
}

function normalizeSql(sql: string) {
  return sql.replace(/\s+/g, ' ').trim();
}
