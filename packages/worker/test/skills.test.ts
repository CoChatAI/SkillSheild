import { describe, expect, it } from 'vitest';
import app from '../src/index';
import type { WorkerBindings } from '../src/types';

type SkillFixture = {
  id: string;
  source: 'skills-sh';
  slug: string;
  name: string;
  description: string | null;
  author: string | null;
  latest_version: string | null;
  latest_scanned_version: string | null;
  verdict: 'verified' | 'caution' | 'blocked' | 'pending';
  scan_severity: 'none' | 'low' | 'medium' | 'high' | 'critical' | null;
  findings_count: number | null;
  last_scanned_at: string | null;
  r2_key: string | null;
  metadata: string | null;
};

const skills: SkillFixture[] = [
  {
    id: 'skills-sh:owner/repo/skill-name',
    source: 'skills-sh',
    slug: 'owner/repo/skill-name',
    name: 'Skill Name',
    description: 'skills.sh mirror entry',
    author: 'Repo Owner',
    latest_version: 'main',
    latest_scanned_version: 'main',
    verdict: 'caution',
    scan_severity: 'medium',
    findings_count: 2,
    last_scanned_at: '2026-03-20T11:00:00.000Z',
    r2_key: 'skills-sh/owner/repo/skill-name/latest.tar.gz',
    metadata: JSON.stringify({ repo: 'owner/repo', tags: ['frontend'] }),
  },
  {
    id: 'skills-sh:owner/repo/blocked-skill',
    source: 'skills-sh',
    slug: 'owner/repo/blocked-skill',
    name: 'Blocked Skill',
    description: 'Unsafe skill',
    author: 'Repo Owner',
    latest_version: 'main',
    latest_scanned_version: 'main',
    verdict: 'blocked',
    scan_severity: 'critical',
    findings_count: 4,
    last_scanned_at: '2026-03-19T11:00:00.000Z',
    r2_key: null,
    metadata: JSON.stringify({ repo: 'owner/repo' }),
  },
  {
    id: 'skills-sh:owner/repo/pending-skill',
    source: 'skills-sh',
    slug: 'owner/repo/pending-skill',
    name: 'Pending Skill',
    description: 'Still scanning',
    author: 'Repo Owner',
    latest_version: 'main',
    latest_scanned_version: null,
    verdict: 'pending',
    scan_severity: null,
    findings_count: 0,
    last_scanned_at: null,
    r2_key: null,
    metadata: JSON.stringify({ repo: 'owner/repo' }),
  },
];

const skillObjects = new Map<string, Uint8Array>([
  ['skills-sh/owner/repo/skill-name/latest.tar.gz', new Uint8Array([9, 8, 7])],
]);

describe('skills.sh worker routes', () => {
  it('returns skills.sh metadata for a servable skill', async () => {
    const response = await app.request('http://localhost/skills/owner/repo/skill-name', {}, createEnv());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      source: 'skills-sh',
      owner: 'owner',
      repo: 'repo',
      skill: 'skill-name',
      slug: 'owner/repo/skill-name',
      name: 'Skill Name',
      description: 'skills.sh mirror entry',
      author: 'Repo Owner',
      version: 'main',
      verdict: 'caution',
      severity: 'medium',
      findings: 2,
      scanned_at: '2026-03-20T11:00:00.000Z',
      report: 'https://skillshield.cochat.ai/reports/skills/owner/repo/skill-name.json',
      badge: 'https://skillshield.cochat.ai/badge/skills/owner/repo/skill-name.svg',
      download: '/skills/owner/repo/skill-name/dl',
      metadata: {
        repo: 'owner/repo',
        tags: ['frontend'],
      },
    });
  });

  it('returns blocked metadata details for blocked skills', async () => {
    const response = await app.request('http://localhost/skills/owner/repo/blocked-skill', {}, createEnv());

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({
      error: 'skill_blocked',
      message: 'Skill "owner/repo/blocked-skill" was blocked by SkillShield due to critical severity security findings.',
      report: 'https://skillshield.cochat.ai/reports/skills/owner/repo/blocked-skill.json',
    });
  });

  it('downloads the latest tarball for a servable skill', async () => {
    const response = await app.request('http://localhost/skills/owner/repo/skill-name/dl', {}, createEnv());

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('application/gzip');
    expect(response.headers.get('content-disposition')).toBe('attachment; filename="skill-name.tar.gz"');
    expect(response.headers.get('cache-control')).toBe('public, max-age=3600');
    expect(response.headers.get('x-skillshield-verdict')).toBe('caution');
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(new Uint8Array([9, 8, 7]));
  });

  it('returns blocked download details for blocked skills', async () => {
    const response = await app.request('http://localhost/skills/owner/repo/blocked-skill/dl', {}, createEnv());

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({
      error: 'skill_blocked',
      message: 'Blocked due to security findings. See report.',
      report: 'https://skillshield.cochat.ai/reports/skills/owner/repo/blocked-skill.json',
    });
  });

  it('returns not_found for pending or missing skills', async () => {
    const pendingResponse = await app.request('http://localhost/skills/owner/repo/pending-skill', {}, createEnv());
    const missingDownloadResponse = await app.request('http://localhost/skills/owner/repo/missing-skill/dl', {}, createEnv());

    expect(pendingResponse.status).toBe(404);
    await expect(pendingResponse.json()).resolves.toEqual({ error: 'not_found' });

    expect(missingDownloadResponse.status).toBe(404);
    await expect(missingDownloadResponse.json()).resolves.toEqual({
      error: 'not_found',
      message: 'Skill not found or not yet scanned.',
      report: 'https://skillshield.cochat.ai/reports/skills/owner/repo/missing-skill.json',
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
      const normalizedSql = normalizeSql(sql);
      let boundParams: unknown[] = [];

      return {
        bind(...params: unknown[]) {
          boundParams = params;
          return this;
        },
        async first() {
          if (normalizedSql !== 'SELECT * FROM skills WHERE source = ? AND slug = ?') {
            throw new Error(`Unhandled first() query: ${normalizedSql}`);
          }

          const source = String(boundParams[0]);
          const slug = String(boundParams[1]);
          return skills.find((skill) => skill.source === source && skill.slug === slug) ?? null;
        },
      } as D1PreparedStatement;
    },
  } as D1Database;
}

function normalizeSql(sql: string) {
  return sql.replace(/\s+/g, ' ').trim();
}
