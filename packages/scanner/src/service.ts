import { rm } from 'node:fs/promises';
import { scanJobLocatorSchema, type ScanJobLocator, type SkillSource, type SkillVerdict } from '@skillshield/shared';
import type { ScanOptions } from './scanner';
import { determineVerdict, scanSkill } from './scanner';
import { publishResults, type PublishVerdict } from './publisher';
import { ClawHubAdapter } from './adapters/clawhub';
import { SkillsShAdapter } from './adapters/skills-sh';

export interface ScannerSkillListItem {
  slug: string;
  name: string;
  latestVersion?: string;
}

export interface ScannerSourceAdapter {
  source: SkillSource;
  listAll(): Promise<ScannerSkillListItem[]>;
  fetch(slug: string, version?: string): Promise<string>;
}

export type ScanJobRequest = ScanJobLocator;

export interface ExecuteScanJobResult {
  source: SkillSource;
  slug: string;
  version: string;
  verdict: PublishVerdict;
}

export interface FullScrapeOptions {
  limit?: number;
  scanOptions?: ScanOptions;
  interSkillDelayMs?: number;
}

export interface FullScrapeResult {
  source: SkillSource;
  discovered: number;
  attempted: number;
  completed: number;
  failed: number;
  verdicts: Record<SkillVerdict, number>;
}

export interface ServiceDependencies {
  adapters?: Partial<Record<SkillSource, ScannerSourceAdapter>>;
  scanSkill?: typeof scanSkill;
  publishResults?: typeof publishResults;
  sleep?: (milliseconds: number) => Promise<void>;
  removeDir?: (path: string) => Promise<void>;
  logger?: Pick<Console, 'log' | 'error'>;
}

const DEFAULT_SCAN_OPTIONS: ScanOptions = {
  useBehavioral: true,
  useLlm: true,
  enableMeta: true,
  policy: 'strict',
};

export function createDefaultAdapters(): Partial<Record<SkillSource, ScannerSourceAdapter>> {
  return {
    clawhub: new ClawHubAdapter(),
    'skills-sh': new SkillsShAdapter(),
  };
}

export async function executeScanJob(
  input: ScanJobRequest,
  dependencies: ServiceDependencies = {},
): Promise<ExecuteScanJobResult> {
  const parsedJob = scanJobLocatorSchema.safeParse(input);
  if (!parsedJob.success) {
    throw new Error(parsedJob.error.issues[0]?.message ?? 'Invalid scan job payload.');
  }

  const job = parsedJob.data;
  const source = parseSource(job.source);
  const slug = resolveSlug(job);
  const version = job.version ?? 'latest';
  const adapter = requireAdapter(source, dependencies.adapters);
  const scanSkillImpl = dependencies.scanSkill ?? scanSkill;
  const publishResultsImpl = dependencies.publishResults ?? publishResults;
  const removeDirImpl = dependencies.removeDir ?? defaultRemoveDir;
  const logger = dependencies.logger ?? console;
  let skillDir: string | undefined;

  logger.log(`[scan] Starting: ${source}/${slug} v${version}`);

  try {
    skillDir = await adapter.fetch(slug, job.version);
    const scanResult = await scanSkillImpl(skillDir, buildScanOptions());
    const verdict = buildPublishVerdict(scanResult.maxSeverity, scanResult.findingsCount);

    await publishResultsImpl({
      source,
      slug,
      version,
      skillDir,
      scanResult,
      verdict,
    });

    logger.log(`[scan] Complete: ${source}/${slug} -> ${verdict.verdict}`);

    return {
      source,
      slug,
      version,
      verdict,
    };
  } finally {
    if (skillDir) {
      await removeDirImpl(skillDir).catch(() => undefined);
    }
  }
}

export async function runFullSourceScrape(
  sourceInput: SkillSource,
  options: FullScrapeOptions = {},
  dependencies: ServiceDependencies = {},
): Promise<FullScrapeResult> {
  const source = parseSource(sourceInput);
  const adapter = requireAdapter(source, dependencies.adapters);
  const scanSkillImpl = dependencies.scanSkill ?? scanSkill;
  const publishResultsImpl = dependencies.publishResults ?? publishResults;
  const sleepImpl = dependencies.sleep ?? defaultSleep;
  const removeDirImpl = dependencies.removeDir ?? defaultRemoveDir;
  const logger = dependencies.logger ?? console;
  const discoveredSkills = await adapter.listAll();
  const skills = typeof options.limit === 'number'
    ? discoveredSkills.slice(0, options.limit)
    : discoveredSkills;
  const scanOptions = buildScanOptions(options.scanOptions);
  const verdicts: FullScrapeResult['verdicts'] = {
    verified: 0,
    caution: 0,
    blocked: 0,
    pending: 0,
  };
  let completed = 0;
  let failed = 0;

  logger.log(`[scrape] Found ${discoveredSkills.length} skills in ${source}`);

  for (const [index, skill] of skills.entries()) {
    let skillDir: string | undefined;

    try {
      const version = skill.latestVersion ?? 'latest';
      skillDir = await adapter.fetch(skill.slug, skill.latestVersion);

      const scanResult = await scanSkillImpl(skillDir, scanOptions);
      const verdict = buildPublishVerdict(scanResult.maxSeverity, scanResult.findingsCount);

      await publishResultsImpl({
        source,
        slug: skill.slug,
        version,
        skillDir,
        scanResult,
        verdict,
        metadata: buildMetadata(skill),
      });

      verdicts[verdict.verdict] += 1;
      completed += 1;
      logger.log(`[scrape] Complete: ${source}/${skill.slug} -> ${verdict.verdict}`);
    } catch (error) {
      failed += 1;
      logger.error(`[scrape] Failed: ${skill.slug}`, error);
    } finally {
      if (skillDir) {
        await removeDirImpl(skillDir).catch(() => undefined);
      }
    }

    if (index < skills.length - 1 && (options.interSkillDelayMs ?? 200) > 0) {
      await sleepImpl(options.interSkillDelayMs ?? 200);
    }
  }

  return {
    source,
    discovered: discoveredSkills.length,
    attempted: skills.length,
    completed,
    failed,
    verdicts,
  };
}

export function buildPublishVerdict(maxSeverity: string, findingsCount: number): PublishVerdict {
  const verdict = determineVerdict({ maxSeverity: normalizeSeverity(maxSeverity) });
  const severity = normalizeSeverity(maxSeverity);

  return {
    verdict,
    severity,
    findingsCount,
  };
}

export function buildScanOptions(overrides: ScanOptions = {}): ScanOptions {
  return {
    ...DEFAULT_SCAN_OPTIONS,
    ...overrides,
  };
}

export function parseSource(value: string): SkillSource {
  if (value === 'clawhub' || value === 'skills-sh') {
    return value;
  }

  throw new Error(`Unknown source: ${value}`);
}

function buildMetadata(skill: ScannerSkillListItem) {
  const metadata = {
    name: skill.name,
    latestVersion: skill.latestVersion ?? 'latest',
  };

  const slugParts = skill.slug.split('/');
  if (slugParts.length === 3) {
    return {
      ...metadata,
      metadata: {
        repo: `${slugParts[0]}/${slugParts[1]}`,
      },
    };
  }

  return metadata;
}

function requireAdapter(
  source: SkillSource,
  adapters: Partial<Record<SkillSource, ScannerSourceAdapter>> | undefined,
) {
  const adapter = (adapters ?? createDefaultAdapters())[source];

  if (!adapter) {
    throw new Error(`Source not configured yet: ${source}`);
  }

  return adapter;
}

function resolveSlug(input: ScanJobLocator) {
  const slug = input.slug ?? input.repo;

  if (!slug) {
    throw new Error('Scan jobs require either a slug or repo field.');
  }

  return slug;
}

function normalizeOptionalString(value: string | undefined) {
  const trimmedValue = value?.trim();
  return trimmedValue ? trimmedValue : undefined;
}

function normalizeSeverity(value: string): PublishVerdict['severity'] {
  switch (value) {
    case 'none':
    case 'low':
    case 'medium':
    case 'high':
    case 'critical':
      return value;
    default:
      return 'none';
  }
}

async function defaultSleep(milliseconds: number) {
  await new Promise<void>((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}

async function defaultRemoveDir(path: string) {
  await rm(path, { recursive: true, force: true });
}
