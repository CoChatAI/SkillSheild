import { describe, expect, it, vi } from 'vitest';
import type { SkillScanResult } from '@skillshield/shared';
import { buildD1Statements } from '../src/db';
import {
  buildPublishedKeys,
  buildPublishedReport,
  publishResults,
  shouldPublishAssets,
} from '../src/publisher';

const scanResult: SkillScanResult = {
  findings: [
    {
      severity: 'medium',
      category: 'prompt_injection',
      analyzer: 'llm',
      description: 'Potential prompt injection vector',
      location: 'SKILL.md:12',
    },
  ],
  findingsCount: 1,
  maxSeverity: 'medium',
  isSafe: false,
  scannerVersion: '2.4.1',
  analyzersUsed: ['static', 'llm'],
  policy: 'strict',
};

describe('publisher helpers', () => {
  it('builds the public scan report shape', () => {
    const report = buildPublishedReport({
      source: 'clawhub',
      slug: 'trello',
      version: '1.2.3',
      skillDir: '/tmp/trello',
      scanResult,
      verdict: { verdict: 'caution', severity: 'medium', findingsCount: 1 },
      scannedAt: '2026-03-21T00:00:00.000Z',
    });

    expect(report).toEqual({
      skill: 'trello',
      source: 'clawhub',
      version: '1.2.3',
      scanned_at: '2026-03-21T00:00:00.000Z',
      verdict: 'caution',
      severity: 'medium',
      findings_count: 1,
      findings: scanResult.findings,
      scanner_version: '2.4.1',
      analyzers_used: ['static', 'llm'],
      policy: 'strict',
    });
  });

  it('builds report and asset keys using source conventions', () => {
    expect(buildPublishedKeys('clawhub', 'team/trello', '1.2.3')).toEqual({
      reportKey: 'clawhub/team/trello.json',
      assetKeys: ['clawhub/team/trello/1.2.3.zip', 'clawhub/team/trello/latest.zip'],
      latestAssetKey: 'clawhub/team/trello/latest.zip',
    });

    expect(buildPublishedKeys('skills-sh', 'owner/repo/skill-name', 'main')).toEqual({
      reportKey: 'skills-sh/owner/repo/skill-name.json',
      assetKeys: ['skills-sh/owner/repo/skill-name/latest.tar.gz'],
      latestAssetKey: 'skills-sh/owner/repo/skill-name/latest.tar.gz',
    });
  });

  it('treats blocked and pending skills as non-servable', () => {
    expect(shouldPublishAssets('verified')).toBe(true);
    expect(shouldPublishAssets('caution')).toBe(true);
    expect(shouldPublishAssets('blocked')).toBe(false);
    expect(shouldPublishAssets('pending')).toBe(false);
  });
});

describe('publishResults', () => {
  it('uploads reports and assets for servable skills and updates D1', async () => {
    const putObject = vi.fn(async () => {});
    const publishScanResult = vi.fn(async () => {});
    const buildArchive = vi.fn(async () => ({
      body: new Uint8Array([1, 2, 3]),
      contentType: 'application/zip',
    }));

    const result = await publishResults(
      {
        source: 'clawhub',
        slug: 'trello',
        version: '1.2.3',
        skillDir: '/tmp/trello',
        scanResult,
        verdict: { verdict: 'caution', severity: 'medium', findingsCount: 1 },
        scannedAt: '2026-03-21T00:00:00.000Z',
        metadata: {
          name: 'Trello',
          author: 'Acme',
          description: 'Kanban helper',
          installs: 12,
          metadata: { tags: ['productivity'] },
        },
      },
      {
        storage: { putObject },
        database: { publishScanResult },
        archiveBuilder: { buildArchive },
      },
    );

    expect(buildArchive).toHaveBeenCalledWith('clawhub', '/tmp/trello');
    expect(putObject).toHaveBeenCalledTimes(3);
    expect(putObject).toHaveBeenNthCalledWith(1, {
      bucket: 'skillshield-reports',
      key: 'clawhub/trello.json',
      body: expect.stringContaining('"verdict": "caution"'),
      contentType: 'application/json',
    });
    expect(putObject).toHaveBeenNthCalledWith(2, {
      bucket: 'skillshield-skills',
      key: 'clawhub/trello/1.2.3.zip',
      body: new Uint8Array([1, 2, 3]),
      contentType: 'application/zip',
    });
    expect(putObject).toHaveBeenNthCalledWith(3, {
      bucket: 'skillshield-skills',
      key: 'clawhub/trello/latest.zip',
      body: new Uint8Array([1, 2, 3]),
      contentType: 'application/zip',
    });
    expect(publishScanResult).toHaveBeenCalledWith(expect.objectContaining({
      source: 'clawhub',
      slug: 'trello',
      version: '1.2.3',
      verdict: 'caution',
      severity: 'medium',
      findingsCount: 1,
      r2Key: 'clawhub/trello/latest.zip',
      reportKey: 'clawhub/trello.json',
    }));
    expect(result.keys.latestAssetKey).toBe('clawhub/trello/latest.zip');
  });

  it('uploads only the report for blocked skills and stores a null asset key', async () => {
    const putObject = vi.fn(async () => {});
    const publishScanResult = vi.fn(async () => {});
    const buildArchive = vi.fn(async () => ({
      body: new Uint8Array([9, 9, 9]),
      contentType: 'application/gzip',
    }));

    await publishResults(
      {
        source: 'skills-sh',
        slug: 'owner/repo/skill-name',
        version: 'main',
        skillDir: '/tmp/skill-name',
        scanResult: {
          ...scanResult,
          maxSeverity: 'high',
          findings: [
            {
              severity: 'high',
              category: 'scanner_error',
              analyzer: 'system',
              description: 'Scanner failed',
            },
          ],
          findingsCount: 1,
        },
        verdict: { verdict: 'blocked', severity: 'high', findingsCount: 1 },
        scannedAt: '2026-03-21T01:00:00.000Z',
      },
      {
        storage: { putObject },
        database: { publishScanResult },
        archiveBuilder: { buildArchive },
      },
    );

    expect(buildArchive).not.toHaveBeenCalled();
    expect(putObject).toHaveBeenCalledTimes(1);
    expect(putObject).toHaveBeenCalledWith({
      bucket: 'skillshield-reports',
      key: 'skills-sh/owner/repo/skill-name.json',
      body: expect.stringContaining('"verdict": "blocked"'),
      contentType: 'application/json',
    });
    expect(publishScanResult).toHaveBeenCalledWith(expect.objectContaining({
      r2Key: null,
      reportKey: 'skills-sh/owner/repo/skill-name.json',
      verdict: 'blocked',
    }));
  });
});

describe('buildD1Statements', () => {
  it('creates skill and scan_run statements with the expected payloads', () => {
    const statements = buildD1Statements({
      source: 'skills-sh',
      slug: 'owner/repo/skill-name',
      version: 'main',
      verdict: 'caution',
      severity: 'medium',
      findingsCount: 1,
      r2Key: 'skills-sh/owner/repo/skill-name/latest.tar.gz',
      reportKey: 'skills-sh/owner/repo/skill-name.json',
      scanResult,
      scannedAt: '2026-03-21T00:00:00.000Z',
      metadata: {
        name: 'Skill Name',
        description: 'Handles a thing',
        author: 'Jane',
        installs: 42,
        latestVersion: 'main',
        metadata: { repo: 'owner/repo' },
      },
    });

    expect(statements).toHaveLength(2);
    expect(statements[0].sql).toContain('INSERT INTO skills');
    expect(statements[0].params).toEqual([
      'skills-sh:owner/repo/skill-name',
      'skills-sh',
      'owner/repo/skill-name',
      'Skill Name',
      'Handles a thing',
      'Jane',
      'main',
      'main',
      'caution',
      'medium',
      1,
      42,
      null,
      null,
      '2026-03-21T00:00:00.000Z',
      '2026-03-21T00:00:00.000Z',
      '2026-03-21T00:00:00.000Z',
      'skills-sh/owner/repo/skill-name/latest.tar.gz',
      'skills-sh/owner/repo/skill-name.json',
      '{"repo":"owner/repo"}',
    ]);
    expect(statements[0].sql).toContain('installs_updated_at');
    expect(statements[0].sql).toContain('category');
    expect(statements[1].sql).toContain('INSERT INTO scan_runs');
    expect(statements[1].params).toEqual([
      'skills-sh:owner/repo/skill-name:main',
      'skills-sh:owner/repo/skill-name',
      'main',
      '2026-03-21T00:00:00.000Z',
      '2026-03-21T00:00:00.000Z',
      'completed',
      'caution',
      'medium',
      1,
      JSON.stringify(scanResult.findings),
      '2.4.1',
      '["static","llm"]',
      null,
    ]);
  });

  it('forwards category and installsUpdatedAt to the skills upsert', () => {
    const statements = buildD1Statements({
      source: 'skills-sh',
      slug: 'owner/repo/seo-audit',
      version: 'main',
      verdict: 'verified',
      severity: 'low',
      findingsCount: 0,
      r2Key: 'skills-sh/owner/repo/seo-audit/latest.tar.gz',
      reportKey: 'skills-sh/owner/repo/seo-audit.json',
      scanResult,
      scannedAt: '2026-05-05T00:00:00.000Z',
      metadata: {
        name: 'SEO Audit',
        installs: 1234,
        installsUpdatedAt: '2026-05-04T12:00:00.000Z',
        category: 'Marketing & Growth',
      },
    });

    expect(statements[0].params).toContain(1234);
    expect(statements[0].params).toContain('2026-05-04T12:00:00.000Z');
    expect(statements[0].params).toContain('Marketing & Growth');
  });
});
