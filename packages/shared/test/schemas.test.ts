import { describe, expect, it } from 'vitest';
import {
  healthResponseSchema,
  queuedScanJobSchema,
  scanJobLocatorSchema,
  skillRecordSchema,
  skillScanResultSchema,
} from '../src';

describe('shared schemas', () => {
  it('accepts the planned health payload', () => {
    const parsed = healthResponseSchema.parse({
      status: 'ok',
      service: 'skillshield',
    });

    expect(parsed.service).toBe('skillshield');
  });

  it('parses a skill record with metadata defaults', () => {
    const parsed = skillRecordSchema.parse({
      id: 'clawhub:trello',
      source: 'clawhub',
      slug: 'trello',
      name: 'Trello',
      description: null,
      author: null,
      latestVersion: '1.0.0',
      latestScannedVersion: '1.0.0',
      verdict: 'verified',
      scanSeverity: 'none',
      findingsCount: 0,
      installs: 12,
      firstSeenAt: '2026-03-21T00:00:00.000Z',
      lastScannedAt: '2026-03-21T00:00:00.000Z',
      lastUpdatedAt: '2026-03-21T00:00:00.000Z',
      r2Key: 'clawhub/trello/latest.zip',
      reportR2Key: 'clawhub/trello.json',
    });

    expect(parsed.metadata).toEqual({});
  });

  it('parses a normalized scanner result', () => {
    const parsed = skillScanResultSchema.parse({
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
      scannerVersion: '1.2.3',
      analyzersUsed: ['static', 'llm'],
      policy: 'strict',
    });

    expect(parsed.analyzersUsed).toEqual(['static', 'llm']);
  });

  it('parses a queued scan job using the shared queue contract', () => {
    const parsed = queuedScanJobSchema.parse({
      type: 'scan',
      source: 'skills-sh',
      slug: 'anthropics/skills/frontend-design',
      repo: 'anthropics/skills',
      version: 'main',
      triggered_by: 'github_webhook',
      event_id: 'evt_123',
    });

    expect(parsed).toMatchObject({
      type: 'scan',
      source: 'skills-sh',
      slug: 'anthropics/skills/frontend-design',
      repo: 'anthropics/skills',
    });
  });

  it('rejects scan jobs that omit both slug and repo', () => {
    const result = scanJobLocatorSchema.safeParse({
      source: 'clawhub',
      version: '1.2.3',
    });

    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toBe('Scan jobs require either a slug or repo field.');
  });
});
