import { describe, expect, it, vi } from 'vitest';
import { buildScannerArgs, determineVerdict, scanSkill, selectAnalyzers } from '../src/scanner';

describe('scanner wrapper', () => {
  it('builds the expected skill-scanner command', () => {
    expect(
      buildScannerArgs('/tmp/skill', '/tmp/result.json', {
        useBehavioral: true,
        useLlm: true,
        enableMeta: true,
        policy: 'balanced',
      }),
    ).toEqual([
      'scan',
      '/tmp/skill',
      '--format',
      'json',
      '--output',
      '/tmp/result.json',
      '--use-behavioral',
      '--use-llm',
      '--enable-meta',
      '--policy',
      'balanced',
      '--lenient',
    ]);
  });

  it('selects analyzers from scan options', () => {
    expect(selectAnalyzers({})).toEqual(['static']);
    expect(selectAnalyzers({ useBehavioral: true, useLlm: true, enableMeta: true })).toEqual([
      'static',
      'behavioral',
      'llm',
      'meta',
    ]);
  });

  it('normalizes successful scanner output', async () => {
    const execFile = vi.fn(async () => ({ stdout: '', stderr: '' }));
    const readFile = vi.fn(async () => JSON.stringify({
      findings: [
        {
          severity: 'Medium',
          category: 'prompt_injection',
          analyzer: 'llm',
          message: 'Potential prompt injection vector',
          file: 'SKILL.md:12',
        },
      ],
      max_severity: 'Medium',
      is_safe: false,
      scanner_version: '2.4.1',
      analyzers_used: ['static', 'llm'],
    }));
    const makeTempDir = vi.fn(async () => '/tmp/scan-job');
    const removeDir = vi.fn(async () => {});

    const result = await scanSkill(
      '/tmp/skill',
      { useLlm: true },
      { execFile, readFile, makeTempDir, removeDir },
    );

    expect(execFile).toHaveBeenCalledWith(
      'skill-scanner',
      ['scan', '/tmp/skill', '--format', 'json', '--output', '/tmp/scan-job/result.json', '--use-llm', '--policy', 'strict', '--lenient'],
      expect.objectContaining({
        timeout: 120000,
        env: expect.objectContaining({
          SKILL_SCANNER_LLM_MODEL: 'claude-sonnet-4-20250514',
        }),
      }),
    );
    expect(readFile).toHaveBeenCalledWith('/tmp/scan-job/result.json', 'utf8');
    expect(removeDir).toHaveBeenCalledWith('/tmp/scan-job');
    expect(result).toEqual({
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
    });
  });

  it('fails closed when the scanner process errors or the binary is missing', async () => {
    const removeDir = vi.fn(async () => {});

    const result = await scanSkill(
      '/tmp/skill',
      { useBehavioral: true, enableMeta: true },
      {
        execFile: vi.fn(async () => {
          throw new Error('spawn skill-scanner ENOENT');
        }),
        readFile: vi.fn(),
        makeTempDir: vi.fn(async () => '/tmp/scan-job'),
        removeDir,
      },
    );

    expect(result).toEqual({
      findings: [
        {
          severity: 'high',
          category: 'scanner_error',
          analyzer: 'system',
          description: 'Scanner failed: spawn skill-scanner ENOENT',
        },
      ],
      findingsCount: 1,
      maxSeverity: 'high',
      isSafe: false,
      scannerVersion: 'error',
      analyzersUsed: ['static', 'behavioral', 'meta'],
      policy: 'strict',
    });
    expect(removeDir).toHaveBeenCalledWith('/tmp/scan-job');
    expect(determineVerdict(result)).toBe('blocked');
  });
});

describe('determineVerdict', () => {
  it('maps medium severity to caution', () => {
    expect(determineVerdict({ maxSeverity: 'medium' })).toBe('caution');
  });

  it('maps low severity to verified', () => {
    expect(determineVerdict({ maxSeverity: 'low' })).toBe('verified');
  });
});
