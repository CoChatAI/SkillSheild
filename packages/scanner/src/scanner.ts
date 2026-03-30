import { readFile, rm } from 'node:fs/promises';
import type { ExecFileOptions } from 'node:child_process';
import {
  type ScanAnalyzer,
  type ScanFinding,
  type ScanPolicy,
  type ScanSeverity,
  type SkillScanResult,
} from '@skillshield/shared';
import { execFileAsync, makeTempDir } from './utils';

const DEFAULT_SCANNER_BINARY = 'skill-scanner';
const DEFAULT_TIMEOUT_MS = 120_000;

export interface ScanOptions {
  useBehavioral?: boolean;
  useLlm?: boolean;
  enableMeta?: boolean;
  policy?: ScanPolicy;
  timeoutMs?: number;
  binaryPath?: string;
}

interface ExecResult {
  stdout: string;
  stderr: string;
}

interface ScannerDependencies {
  execFile?: (
    file: string,
    args: readonly string[],
    options?: ExecFileOptions,
  ) => Promise<ExecResult>;
  readFile?: (path: string, encoding: BufferEncoding) => Promise<string>;
  makeTempDir?: (prefix: string) => Promise<string>;
  removeDir?: (path: string) => Promise<void>;
}

interface RawScannerFinding {
  severity?: unknown;
  category?: unknown;
  analyzer?: unknown;
  description?: unknown;
  message?: unknown;
  location?: unknown;
  path?: unknown;
  file?: unknown;
}

interface RawScannerResult {
  findings?: unknown;
  max_severity?: unknown;
  is_safe?: unknown;
  scanner_version?: unknown;
  analyzers_used?: unknown;
}

export async function scanSkill(
  skillDir: string,
  options: ScanOptions = {},
  dependencies: ScannerDependencies = {},
): Promise<SkillScanResult> {
  const makeTempDirImpl = dependencies.makeTempDir ?? makeTempDir;
  const readFileImpl = dependencies.readFile ?? readFile;
  const removeDirImpl = dependencies.removeDir ?? defaultRemoveDir;
  const execFileImpl = dependencies.execFile ?? execFileAsync;

  const outputDir = await makeTempDirImpl('skillshield-scan');
  const outputFile = `${outputDir}/result.json`;
  const args = buildScannerArgs(skillDir, outputFile, options);
  const binaryPath = options.binaryPath ?? DEFAULT_SCANNER_BINARY;

  try {
    await execFileImpl(binaryPath, args, {
      timeout: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      env: buildScannerEnv(),
    });

    const rawOutput = await readFileImpl(outputFile, 'utf8');
    return normalizeScannerResult(parseScannerResult(rawOutput), options);
  } catch (error) {
    return buildScannerFailureResult(error, options);
  } finally {
    await removeDirImpl(outputDir).catch(() => undefined);
  }
}

export function determineVerdict(result: Pick<SkillScanResult, 'maxSeverity'>) {
  if (result.maxSeverity === 'high' || result.maxSeverity === 'critical') {
    return 'blocked';
  }

  if (result.maxSeverity === 'medium') {
    return 'caution';
  }

  return 'verified';
}

export function buildScannerArgs(skillDir: string, outputFile: string, options: ScanOptions = {}) {
  const args = ['scan', skillDir, '--format', 'json', '--output', outputFile];

  if (options.useBehavioral) {
    args.push('--use-behavioral');
  }

  if (options.useLlm) {
    args.push('--use-llm');
  }

  if (options.enableMeta) {
    args.push('--enable-meta');
  }

  args.push('--policy', options.policy ?? 'strict');
  args.push('--lenient');

  return args;
}

export function selectAnalyzers(options: Pick<ScanOptions, 'useBehavioral' | 'useLlm' | 'enableMeta'>): ScanAnalyzer[] {
  const analyzers: ScanAnalyzer[] = ['static'];

  if (options.useBehavioral) {
    analyzers.push('behavioral');
  }

  if (options.useLlm) {
    analyzers.push('llm');
  }

  if (options.enableMeta) {
    analyzers.push('meta');
  }

  return analyzers;
}

function normalizeScannerResult(rawResult: RawScannerResult, options: ScanOptions): SkillScanResult {
  const findings = normalizeFindings(rawResult.findings);
  const derivedMaxSeverity = findings.reduce<ScanSeverity>(
    (currentMax, finding) => higherSeverity(currentMax, finding.severity),
    'none',
  );
  const normalizedMaxSeverity = normalizeSeverity(rawResult.max_severity, derivedMaxSeverity);
  const rawAnalyzers = normalizeAnalyzers(rawResult.analyzers_used);
  const analyzersUsed = rawAnalyzers.length > 0 ? rawAnalyzers : selectAnalyzers(options);
  const isSafe = typeof rawResult.is_safe === 'boolean'
    ? rawResult.is_safe && normalizedMaxSeverity !== 'high' && normalizedMaxSeverity !== 'critical'
    : normalizedMaxSeverity === 'none' || normalizedMaxSeverity === 'low';

  return {
    findings,
    findingsCount: findings.length,
    maxSeverity: normalizedMaxSeverity,
    isSafe,
    scannerVersion: normalizeScannerVersion(rawResult.scanner_version),
    analyzersUsed,
    policy: options.policy ?? 'strict',
  };
}

function parseScannerResult(rawOutput: string): RawScannerResult {
  return JSON.parse(rawOutput) as RawScannerResult;
}

function normalizeFindings(rawFindings: unknown): ScanFinding[] {
  if (!Array.isArray(rawFindings)) {
    return [];
  }

  return rawFindings.map((rawFinding) => normalizeFinding(rawFinding as RawScannerFinding));
}

function normalizeFinding(rawFinding: RawScannerFinding): ScanFinding {
  return {
    severity: normalizeSeverity(rawFinding.severity, 'high'),
    category: normalizeString(rawFinding.category, 'unknown'),
    analyzer: normalizeString(rawFinding.analyzer, 'unknown'),
    description: normalizeString(rawFinding.description ?? rawFinding.message, 'Scanner reported a finding without a description.'),
    ...(normalizeLocation(rawFinding) ? { location: normalizeLocation(rawFinding) } : {}),
  };
}

function normalizeLocation(rawFinding: RawScannerFinding) {
  return normalizeOptionalString(rawFinding.location)
    ?? normalizeOptionalString(rawFinding.path)
    ?? normalizeOptionalString(rawFinding.file);
}

function normalizeAnalyzers(rawAnalyzers: unknown): ScanAnalyzer[] {
  if (!Array.isArray(rawAnalyzers)) {
    return [];
  }

  const seen = new Set<ScanAnalyzer>();

  for (const analyzer of rawAnalyzers) {
    const normalizedAnalyzer = normalizeAnalyzer(analyzer);

    if (normalizedAnalyzer) {
      seen.add(normalizedAnalyzer);
    }
  }

  return [...seen];
}

function normalizeAnalyzer(value: unknown): ScanAnalyzer | null {
  switch (normalizeOptionalString(value)?.toLowerCase()) {
    case 'static':
      return 'static';
    case 'behavioral':
      return 'behavioral';
    case 'llm':
      return 'llm';
    case 'meta':
      return 'meta';
    default:
      return null;
  }
}

function normalizeSeverity(value: unknown, fallback: ScanSeverity): ScanSeverity {
  switch (normalizeOptionalString(value)?.toLowerCase()) {
    case 'none':
      return 'none';
    case 'low':
      return 'low';
    case 'medium':
      return 'medium';
    case 'high':
      return 'high';
    case 'critical':
      return 'critical';
    default:
      return fallback;
  }
}

function normalizeScannerVersion(value: unknown) {
  return normalizeString(value, 'unknown');
}

function normalizeString(value: unknown, fallback: string) {
  return normalizeOptionalString(value) ?? fallback;
}

function normalizeOptionalString(value: unknown) {
  if (typeof value !== 'string') {
    return undefined;
  }

  const trimmedValue = value.trim();
  return trimmedValue.length > 0 ? trimmedValue : undefined;
}

function buildScannerEnv() {
  return {
    ...process.env,
    SKILL_SCANNER_LLM_API_KEY: process.env.SKILL_SCANNER_LLM_API_KEY,
    SKILL_SCANNER_LLM_MODEL: process.env.SKILL_SCANNER_LLM_MODEL ?? 'claude-sonnet-4-20250514',
  };
}

function buildScannerFailureResult(error: unknown, options: ScanOptions): SkillScanResult {
  const errorMessage = error instanceof Error ? error.message : 'Unknown scanner failure';

  return {
    findings: [
      {
        severity: 'high',
        category: 'scanner_error',
        analyzer: 'system',
        description: `Scanner failed: ${errorMessage}`,
      },
    ],
    findingsCount: 1,
    maxSeverity: 'high',
    isSafe: false,
    scannerVersion: 'error',
    analyzersUsed: selectAnalyzers(options),
    policy: options.policy ?? 'strict',
  };
}

function higherSeverity(left: ScanSeverity, right: ScanSeverity): ScanSeverity {
  return severityRank(right) > severityRank(left) ? right : left;
}

function severityRank(severity: ScanSeverity) {
  switch (severity) {
    case 'none':
      return 0;
    case 'low':
      return 1;
    case 'medium':
      return 2;
    case 'high':
      return 3;
    case 'critical':
      return 4;
  }
}

async function defaultRemoveDir(path: string) {
  await rm(path, { recursive: true, force: true });
}
