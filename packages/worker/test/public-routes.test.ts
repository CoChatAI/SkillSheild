import { describe, expect, it } from 'vitest';
import app from '../src/index';
import type { WorkerBindings } from '../src/types';

type SkillFixture = {
  id: string;
  source: 'clawhub' | 'skills-sh';
  slug: string;
  name: string;
  description: string | null;
  author: string | null;
  category: string | null;
  latest_version: string | null;
  latest_scanned_version: string | null;
  verdict: 'verified' | 'caution' | 'blocked' | 'pending';
  scan_severity: 'none' | 'low' | 'medium' | 'high' | 'critical' | null;
  findings_count: number;
  installs: number;
  installs_updated_at: string | null;
  first_seen_at: string;
  last_scanned_at: string | null;
  last_updated_at: string;
  r2_key: string | null;
  report_r2_key: string | null;
  metadata: string | null;
};

type ScanRunFixture = {
  id: string;
  skill_id: string;
};

type MockStatement = D1PreparedStatement & {
  __sql: string;
  __getParams: () => unknown[];
};

const skills: SkillFixture[] = [
  {
    id: 'clawhub:trello',
    source: 'clawhub',
    slug: 'trello',
    name: 'Trello',
    description: 'Kanban helper',
    author: 'Acme',
    category: 'Productivity',
    latest_version: '1.2.3',
    latest_scanned_version: '1.2.3',
    verdict: 'verified',
    scan_severity: 'none',
    findings_count: 0,
    installs: 100,
    installs_updated_at: '2026-03-21T12:00:00.000Z',
    first_seen_at: '2026-03-01T00:00:00.000Z',
    last_scanned_at: '2026-03-21T12:00:00.000Z',
    last_updated_at: '2026-03-21T12:00:00.000Z',
    r2_key: 'clawhub/trello/latest.zip',
    report_r2_key: 'clawhub/trello.json',
    metadata: JSON.stringify({ tags: ['productivity'] }),
  },
  {
    id: 'skills-sh:owner/repo/skill-name',
    source: 'skills-sh',
    slug: 'owner/repo/skill-name',
    name: 'Skill Name',
    description: 'skills.sh mirror entry',
    author: 'Repo Owner',
    category: 'Engineering',
    latest_version: 'main',
    latest_scanned_version: 'main',
    verdict: 'caution',
    scan_severity: 'medium',
    findings_count: 2,
    installs: 40,
    installs_updated_at: '2026-03-20T11:00:00.000Z',
    first_seen_at: '2026-03-02T00:00:00.000Z',
    last_scanned_at: '2026-03-20T11:00:00.000Z',
    last_updated_at: '2026-03-20T11:00:00.000Z',
    r2_key: 'skills-sh/owner/repo/skill-name/latest.tar.gz',
    report_r2_key: 'skills-sh/owner/repo/skill-name.json',
    metadata: JSON.stringify({ repo: 'owner/repo' }),
  },
  {
    id: 'clawhub:blocked-skill',
    source: 'clawhub',
    slug: 'blocked-skill',
    name: 'Blocked Skill',
    description: 'Unsafe',
    author: 'Acme',
    category: null,
    latest_version: '9.9.9',
    latest_scanned_version: '9.9.9',
    verdict: 'blocked',
    scan_severity: 'critical',
    findings_count: 5,
    installs: 5,
    installs_updated_at: null,
    first_seen_at: '2026-03-03T00:00:00.000Z',
    last_scanned_at: '2026-03-19T10:00:00.000Z',
    last_updated_at: '2026-03-19T10:00:00.000Z',
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
    category: null,
    latest_version: '0.0.1',
    latest_scanned_version: null,
    verdict: 'pending',
    scan_severity: null,
    findings_count: 0,
    installs: 1,
    installs_updated_at: null,
    first_seen_at: '2026-03-04T00:00:00.000Z',
    last_scanned_at: null,
    last_updated_at: '2026-03-18T10:00:00.000Z',
    r2_key: null,
    report_r2_key: 'clawhub/pending-skill.json',
    metadata: null,
  },
];

const scanRuns: ScanRunFixture[] = [
  { id: 'scan-1', skill_id: 'clawhub:trello' },
  { id: 'scan-2', skill_id: 'skills-sh:owner/repo/skill-name' },
  { id: 'scan-3', skill_id: 'clawhub:blocked-skill' },
];

const reportObjects = new Map<string, string>([
  ['clawhub/trello.json', JSON.stringify({ skill: 'trello', verdict: 'verified' })],
  ['skills-sh/owner/repo/skill-name.json', JSON.stringify({ skill: 'owner/repo/skill-name', verdict: 'caution' })],
]);

describe('public worker routes', () => {
  it('renders the root dashboard with stats and recent scans', async () => {
    const response = await app.request('http://localhost/', {}, createEnv());

    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('public, max-age=300');
    expect(response.headers.get('content-type')).toBe('text/html; charset=UTF-8');

    const html = await response.text();
    expect(html).toContain('SkillShield Dashboard');
    expect(html).toContain('Only serve the skills you can trust.');
    expect(html).toContain('Recent scans');
    expect(html).toContain('owner/repo/skill-name');
  });

  it('serves ClawHub scan reports from R2', async () => {
    const response = await app.request('http://localhost/reports/clawhub/trello.json', {}, createEnv());

    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('public, max-age=600');
    await expect(response.json()).resolves.toEqual({ skill: 'trello', verdict: 'verified' });
  });

  it('returns no_report when a public report is missing', async () => {
    const response = await app.request(
      'http://localhost/reports/skills/owner/repo/missing.json',
      {},
      createEnv(),
    );

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({ error: 'no_report' });
  });

  it('renders badge SVGs using the stored verdict', async () => {
    const response = await app.request('http://localhost/badge/skills/owner/repo/skill-name.svg', {}, createEnv());

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('image/svg+xml; charset=utf-8');
    const svg = await response.text();
    expect(svg).toContain('SkillShield');
    expect(svg).toContain('caution');
  });

  it('searches unified API results with filters and parsed metadata', async () => {
    const response = await app.request(
      'http://localhost/api/v1/search?q=skill&source=skills-sh&verdict=caution&limit=10',
      {},
      createEnv(),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      skills: [
        {
          id: 'skills-sh:owner/repo/skill-name',
          source: 'skills-sh',
          slug: 'owner/repo/skill-name',
          name: 'Skill Name',
          description: 'skills.sh mirror entry',
          author: 'Repo Owner',
          category: 'Engineering',
          latestVersion: 'main',
          latestScannedVersion: 'main',
          verdict: 'caution',
          scanSeverity: 'medium',
          findingsCount: 2,
          installs: 40,
          installsUpdatedAt: '2026-03-20T11:00:00.000Z',
          firstSeenAt: '2026-03-02T00:00:00.000Z',
          lastScannedAt: '2026-03-20T11:00:00.000Z',
          lastUpdatedAt: '2026-03-20T11:00:00.000Z',
          r2Key: 'skills-sh/owner/repo/skill-name/latest.tar.gz',
          reportR2Key: 'skills-sh/owner/repo/skill-name.json',
          metadata: { repo: 'owner/repo' },
        },
      ],
      count: 1,
      offset: 0,
    });
  });

  it('honors sort=name:asc on /api/v1/search', async () => {
    const response = await app.request(
      'http://localhost/api/v1/search?sort=name%3Aasc&limit=10',
      {},
      createEnv(),
    );

    expect(response.status).toBe(200);
    const payload = (await response.json()) as { skills: Array<{ slug: string }> };
    expect(payload.skills.map((skill) => skill.slug)).toEqual([
      'blocked-skill',
      'pending-skill',
      'owner/repo/skill-name',
      'trello',
    ]);
  });

  it('filters by category on /api/v1/search', async () => {
    const response = await app.request(
      'http://localhost/api/v1/search?category=Engineering&limit=10',
      {},
      createEnv(),
    );

    expect(response.status).toBe(200);
    const payload = (await response.json()) as { skills: Array<{ slug: string }> };
    expect(payload.skills.map((skill) => skill.slug)).toEqual(['owner/repo/skill-name']);
  });

  it('serves a skills.sh-compatible search response for the `skills` CLI', async () => {
    const response = await app.request('http://localhost/api/search?q=skill&limit=10', {}, createEnv());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      skills: [
        {
          id: 'owner/repo/skill-name',
          name: 'Skill Name',
          installs: 40,
          source: 'owner/repo',
        },
      ],
    });
  });

  it('returns verification details with the public report and badge URLs', async () => {
    const response = await app.request(
      'http://localhost/api/v1/verify/skills-sh/owner/repo/skill-name',
      {},
      createEnv(),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      verified: false,
      verdict: 'caution',
      severity: 'medium',
      findings: 2,
      scanned_at: '2026-03-20T11:00:00.000Z',
      report: 'https://skillshield.cochat.ai/reports/skills/owner/repo/skill-name.json',
      badge: 'https://skillshield.cochat.ai/badge/skills/owner/repo/skill-name.svg',
    });
  });

  it('returns not_scanned for missing verify requests', async () => {
    const response = await app.request(
      'http://localhost/api/v1/verify/clawhub/missing-skill',
      {},
      createEnv(),
    );

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({ verified: false, reason: 'not_scanned' });
  });

  it('returns aggregate stats and recent results', async () => {
    const statsResponse = await app.request('http://localhost/api/v1/stats', {}, createEnv());
    const recentResponse = await app.request('http://localhost/api/v1/recent?limit=2', {}, createEnv());

    expect(statsResponse.status).toBe(200);
    expect(recentResponse.status).toBe(200);

    const stats = (await statsResponse.json()) as Record<string, unknown>;
    expect(stats.total_skills).toBe(4);
    expect(stats.verified).toBe(1);
    expect(stats.caution).toBe(1);
    expect(stats.blocked).toBe(1);
    expect(stats.pending).toBe(1);
    expect(stats.total_scans).toBe(3);
    expect(stats.by_source).toEqual([
      { source: 'clawhub', count: 3 },
      { source: 'skills-sh', count: 1 },
    ]);
    expect(typeof stats.last_updated).toBe('string');

    await expect(recentResponse.json()).resolves.toEqual({
      skills: [
        {
          source: 'clawhub',
          slug: 'trello',
          name: 'Trello',
          verdict: 'verified',
          severity: 'none',
          findings_count: 0,
          last_scanned_at: '2026-03-21T12:00:00.000Z',
          report: 'https://skillshield.cochat.ai/reports/clawhub/trello.json',
          badge: 'https://skillshield.cochat.ai/badge/clawhub/trello.svg',
        },
        {
          source: 'skills-sh',
          slug: 'owner/repo/skill-name',
          name: 'Skill Name',
          verdict: 'caution',
          severity: 'medium',
          findings_count: 2,
          last_scanned_at: '2026-03-20T11:00:00.000Z',
          report: 'https://skillshield.cochat.ai/reports/skills/owner/repo/skill-name.json',
          badge: 'https://skillshield.cochat.ai/badge/skills/owner/repo/skill-name.svg',
        },
      ],
      count: 2,
    });
  });
});

function createEnv(): WorkerBindings {
  return {
    DB: createMockDatabase(),
    SKILLS_BUCKET: {} as R2Bucket,
    REPORTS_BUCKET: createMockReportsBucket(),
    META_BUCKET: {} as R2Bucket,
    SCAN_QUEUE: {} as Queue,
    ENVIRONMENT: 'test',
  };
}

function createMockReportsBucket(): R2Bucket {
  return {
    get: async (key: string) => {
      const value = reportObjects.get(key);

      if (!value) {
        return null;
      }

      return {
        body: value,
      } as unknown as R2ObjectBody;
    },
  } as R2Bucket;
}

function createMockDatabase(): D1Database {
  return {
    prepare(sql: string) {
      return createStatement(sql);
    },
    async batch(statements: D1PreparedStatement[]) {
      return statements.map((statement) => {
        const mockStatement = statement as MockStatement;
        return executeBatch(mockStatement.__sql, mockStatement.__getParams());
      });
    },
  } as D1Database;
}

function createStatement(sql: string): MockStatement {
  const normalizedSql = normalizeSql(sql);
  let boundParams: unknown[] = [];

  return {
    __sql: normalizedSql,
    __getParams: () => boundParams,
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
  } as MockStatement;
}

function executeAll(sql: string, params: unknown[]) {
  if (sql === 'SELECT * FROM skills ORDER BY CASE WHEN last_scanned_at IS NULL THEN 1 ELSE 0 END, last_scanned_at DESC, last_updated_at DESC LIMIT ?') {
    const limit = Number(params[0]);

    return [...skills]
      .sort((left, right) => {
        if (left.last_scanned_at === null && right.last_scanned_at !== null) {
          return 1;
        }

        if (left.last_scanned_at !== null && right.last_scanned_at === null) {
          return -1;
        }

        if (left.last_scanned_at !== right.last_scanned_at) {
          return (right.last_scanned_at ?? '').localeCompare(left.last_scanned_at ?? '');
        }

        return right.last_updated_at.localeCompare(left.last_updated_at);
      })
      .slice(0, limit);
  }

  if (!sql.startsWith('SELECT * FROM skills WHERE 1 = 1')) {
    throw new Error(`Unhandled all() query: ${sql}`);
  }

  let paramIndex = 0;
  let query: string | undefined;
  let source: string | undefined;
  let verdict: string | undefined;
  let category: string | undefined;

  if (sql.includes('(name LIKE ? OR description LIKE ? OR slug LIKE ?)')) {
    query = String(params[paramIndex]).slice(1, -1).toLowerCase();
    paramIndex += 3;
  }

  if (sql.includes('AND source = ?')) {
    source = String(params[paramIndex]);
    paramIndex += 1;
  }

  if (sql.includes('AND verdict = ?')) {
    verdict = String(params[paramIndex]);
    paramIndex += 1;
  }

  if (sql.includes('AND category = ?')) {
    category = String(params[paramIndex]);
    paramIndex += 1;
  }

  const limit = Number(params[paramIndex]);
  const offset = Number(params[paramIndex + 1]);

  const filtered = skills
    .filter((skill) => (source ? skill.source === source : true))
    .filter((skill) => (verdict ? skill.verdict === verdict : true))
    .filter((skill) => (category ? skill.category === category : true))
    .filter((skill) => {
      if (!query) {
        return true;
      }

      return [skill.slug, skill.name, skill.description ?? ''].join(' ').toLowerCase().includes(query);
    });

  const sorted = [...filtered].sort((left, right) => {
    if (sql.includes('ORDER BY name COLLATE NOCASE ASC')) {
      const nameCompare = left.name.localeCompare(right.name, undefined, { sensitivity: 'base' });
      return nameCompare !== 0 ? nameCompare : left.slug.localeCompare(right.slug);
    }

    if (sql.includes('ORDER BY CASE WHEN last_scanned_at IS NULL')) {
      const leftMissing = left.last_scanned_at === null ? 1 : 0;
      const rightMissing = right.last_scanned_at === null ? 1 : 0;
      if (leftMissing !== rightMissing) {
        return leftMissing - rightMissing;
      }
      const scannedCompare = (right.last_scanned_at ?? '').localeCompare(left.last_scanned_at ?? '');
      return scannedCompare !== 0
        ? scannedCompare
        : right.last_updated_at.localeCompare(left.last_updated_at);
    }

    return (
      right.installs - left.installs
      || right.last_updated_at.localeCompare(left.last_updated_at)
    );
  });

  return sorted.slice(offset, offset + limit);
}

function executeFirst(sql: string, params: unknown[]) {
  if (sql === 'SELECT * FROM skills WHERE source = ? AND slug = ?') {
    const source = String(params[0]);
    const slug = String(params[1]);
    return skills.find((skill) => skill.source === source && skill.slug === slug) ?? null;
  }

  throw new Error(`Unhandled first() query: ${sql}`);
}

function executeBatch(sql: string, _params: unknown[]) {
  if (sql === 'SELECT COUNT(*) as total FROM skills') {
    return { results: [{ total: skills.length }] } as D1Result<unknown>;
  }

  if (sql === "SELECT COUNT(*) as count FROM skills WHERE verdict = 'verified'") {
    return { results: [{ count: countSkillsByVerdict('verified') }] } as D1Result<unknown>;
  }

  if (sql === "SELECT COUNT(*) as count FROM skills WHERE verdict = 'caution'") {
    return { results: [{ count: countSkillsByVerdict('caution') }] } as D1Result<unknown>;
  }

  if (sql === "SELECT COUNT(*) as count FROM skills WHERE verdict = 'blocked'") {
    return { results: [{ count: countSkillsByVerdict('blocked') }] } as D1Result<unknown>;
  }

  if (sql === "SELECT COUNT(*) as count FROM skills WHERE verdict = 'pending'") {
    return { results: [{ count: countSkillsByVerdict('pending') }] } as D1Result<unknown>;
  }

  if (sql === 'SELECT COUNT(*) as total FROM scan_runs') {
    return { results: [{ total: scanRuns.length }] } as D1Result<unknown>;
  }

  if (sql === 'SELECT source, COUNT(*) as count FROM skills GROUP BY source ORDER BY source ASC') {
    return {
      results: [
        { source: 'clawhub', count: skills.filter((skill) => skill.source === 'clawhub').length },
        { source: 'skills-sh', count: skills.filter((skill) => skill.source === 'skills-sh').length },
      ],
    } as D1Result<unknown>;
  }

  throw new Error(`Unhandled batch() query: ${sql}`);
}

function countSkillsByVerdict(verdict: SkillFixture['verdict']) {
  return skills.filter((skill) => skill.verdict === verdict).length;
}

function normalizeSql(sql: string) {
  return sql.replace(/\s+/g, ' ').trim();
}
