import { readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { AwsClient } from 'aws4fetch';
import type { SkillScanResult, SkillSource, SkillVerdict, ScanSeverity } from '@skillshield/shared';
import { execFileAsync, makeTempDir } from './utils';
import {
  createCloudflareD1Client,
  type D1DatabaseClient,
  type SkillRecordMetadata,
} from './db';

const DEFAULT_SKILLS_BUCKET = 'skillshield-skills';
const DEFAULT_REPORTS_BUCKET = 'skillshield-reports';

export interface PublishVerdict {
  verdict: SkillVerdict;
  severity: ScanSeverity;
  findingsCount: number;
}

export interface PublishInput {
  source: SkillSource;
  slug: string;
  version: string;
  skillDir: string;
  scanResult: SkillScanResult;
  verdict: PublishVerdict;
  scannedAt?: string;
  metadata?: SkillRecordMetadata;
}

export interface PublishedKeys {
  reportKey: string;
  assetKeys: string[];
  latestAssetKey: string | null;
}

export interface PublishedReport {
  skill: string;
  source: SkillSource;
  version: string;
  scanned_at: string;
  verdict: SkillVerdict;
  severity: ScanSeverity;
  findings_count: number;
  findings: SkillScanResult['findings'];
  scanner_version: string;
  analyzers_used: SkillScanResult['analyzersUsed'];
  policy: SkillScanResult['policy'];
}

export interface ObjectStorageUpload {
  bucket: string;
  key: string;
  body: string | Uint8Array;
  contentType: string;
}

export interface ObjectStorageClient {
  putObject(upload: ObjectStorageUpload): Promise<void>;
}

interface ArchiveBuilder {
  buildArchive(source: SkillSource, skillDir: string): Promise<{ body: Uint8Array; contentType: string }>;
}

interface PublishDependencies {
  storage?: ObjectStorageClient;
  database?: D1DatabaseClient;
  archiveBuilder?: ArchiveBuilder;
}

export function shouldPublishAssets(verdict: SkillVerdict) {
  return verdict !== 'blocked' && verdict !== 'pending';
}

export function buildPublishedKeys(source: SkillSource, slug: string, version: string): PublishedKeys {
  if (source === 'clawhub') {
    return {
      reportKey: `clawhub/${slug}.json`,
      assetKeys: [`clawhub/${slug}/${version}.zip`, `clawhub/${slug}/latest.zip`],
      latestAssetKey: `clawhub/${slug}/latest.zip`,
    };
  }

  return {
    reportKey: `skills-sh/${slug}.json`,
    assetKeys: [`skills-sh/${slug}/latest.tar.gz`],
    latestAssetKey: `skills-sh/${slug}/latest.tar.gz`,
  };
}

export function buildPublishedReport(input: PublishInput): PublishedReport {
  return {
    skill: input.slug,
    source: input.source,
    version: input.version,
    scanned_at: input.scannedAt ?? new Date().toISOString(),
    verdict: input.verdict.verdict,
    severity: input.verdict.severity,
    findings_count: input.verdict.findingsCount,
    findings: input.scanResult.findings,
    scanner_version: input.scanResult.scannerVersion,
    analyzers_used: input.scanResult.analyzersUsed,
    policy: input.scanResult.policy,
  };
}

export async function publishResults(
  input: PublishInput,
  dependencies: PublishDependencies = {},
) {
  const storage = dependencies.storage ?? createR2StorageClientFromEnv();
  const database = dependencies.database ?? createCloudflareD1ClientFromEnv();
  const archiveBuilder = dependencies.archiveBuilder ?? createDefaultArchiveBuilder();
  const scannedAt = input.scannedAt ?? new Date().toISOString();
  const publishInput = { ...input, scannedAt };
  const keys = buildPublishedKeys(input.source, input.slug, input.version);
  const report = buildPublishedReport(publishInput);

  await storage.putObject({
    bucket: getReportsBucketName(),
    key: keys.reportKey,
    body: JSON.stringify(report, null, 2),
    contentType: 'application/json',
  });

  if (shouldPublishAssets(input.verdict.verdict)) {
    const archive = await archiveBuilder.buildArchive(input.source, input.skillDir);

    for (const assetKey of keys.assetKeys) {
      await storage.putObject({
        bucket: getSkillsBucketName(),
        key: assetKey,
        body: archive.body,
        contentType: archive.contentType,
      });
    }
  }

  await database.publishScanResult({
    source: input.source,
    slug: input.slug,
    version: input.version,
    verdict: input.verdict.verdict,
    severity: input.verdict.severity,
    findingsCount: input.verdict.findingsCount,
    r2Key: shouldPublishAssets(input.verdict.verdict) ? keys.latestAssetKey : null,
    reportKey: keys.reportKey,
    scanResult: input.scanResult,
    scannedAt,
    metadata: input.metadata,
  });

  return {
    report,
    keys,
  };
}

export function createCloudflareD1ClientFromEnv() {
  const accountId = requireEnv('CF_ACCOUNT_ID');
  const apiToken = requireEnv('CF_API_TOKEN');
  const databaseId = requireEnv('D1_DATABASE_ID');

  return createCloudflareD1Client({
    accountId,
    apiToken,
    databaseId,
  });
}

export function createR2StorageClientFromEnv() {
  const endpoint = requireEnv('R2_ENDPOINT');
  const accessKeyId = requireEnv('R2_ACCESS_KEY_ID');
  const secretAccessKey = requireEnv('R2_SECRET_ACCESS_KEY');
  const sessionToken = process.env.R2_SESSION_TOKEN;
  const normalizedEndpoint = endpoint.endsWith('/') ? endpoint.slice(0, -1) : endpoint;
  const awsClient = new AwsClient({
    accessKeyId,
    secretAccessKey,
    sessionToken,
    service: 's3',
    region: 'auto',
  });

  return {
    async putObject(upload: ObjectStorageUpload) {
      const response = await awsClient.fetch(`${normalizedEndpoint}/${upload.bucket}/${upload.key}`, {
        method: 'PUT',
        headers: {
          'Content-Type': upload.contentType,
        },
        body: upload.body as BodyInit,
      });

      if (!response.ok) {
        const responseBody = await response.text().catch(() => '');
        const details = responseBody.trim();
        throw new Error(
          details.length > 0
            ? `R2 upload failed for ${upload.bucket}/${upload.key}: ${response.status} ${details}`
            : `R2 upload failed for ${upload.bucket}/${upload.key}: ${response.status}`,
        );
      }
    },
  } satisfies ObjectStorageClient;
}

function createDefaultArchiveBuilder(): ArchiveBuilder {
  return {
    async buildArchive(source, skillDir) {
      return source === 'clawhub'
        ? buildZipArchive(skillDir)
        : buildTarArchive(skillDir);
    },
  };
}

async function buildZipArchive(skillDir: string) {
  return buildArchiveFile({
    skillDir,
    extension: 'zip',
    contentType: 'application/zip',
    command: 'zip',
    args: (archivePath) => ['-r', archivePath, '.'],
    cwd: skillDir,
  });
}

async function buildTarArchive(skillDir: string) {
  return buildArchiveFile({
    skillDir,
    extension: 'tar.gz',
    contentType: 'application/gzip',
    command: 'tar',
    args: (archivePath) => ['-czf', archivePath, '-C', skillDir, '.'],
  });
}

async function buildArchiveFile(options: {
  skillDir: string;
  extension: string;
  contentType: string;
  command: string;
  args: (archivePath: string) => string[];
  cwd?: string;
}) {
  const archiveDir = await makeTempDir('skillshield-publish');
  const archivePath = join(archiveDir, `asset.${options.extension}`);

  try {
    await execFileAsync(options.command, options.args(archivePath), options.cwd ? { cwd: options.cwd } : undefined);
    const archiveBody = await readFile(archivePath);

    return {
      body: new Uint8Array(archiveBody),
      contentType: options.contentType,
    };
  } finally {
    await rm(archiveDir, { recursive: true, force: true }).catch(() => undefined);
  }
}

function requireEnv(name: string) {
  const value = process.env[name]?.trim();

  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }

  return value;
}

function getSkillsBucketName() {
  return process.env.R2_SKILLS_BUCKET?.trim() || DEFAULT_SKILLS_BUCKET;
}

function getReportsBucketName() {
  return process.env.R2_REPORTS_BUCKET?.trim() || DEFAULT_REPORTS_BUCKET;
}
