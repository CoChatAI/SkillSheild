import type { SkillScanResult, SkillSource, SkillVerdict, ScanSeverity } from '@skillshield/shared';

const CLOUDFLARE_D1_QUERY_PATH = '/client/v4/accounts';

export interface SkillRecordMetadata {
  name?: string;
  description?: string | null;
  author?: string | null;
  installs?: number;
  latestVersion?: string | null;
  metadata?: Record<string, unknown>;
}

export interface PublishDatabasePayload {
  source: SkillSource;
  slug: string;
  version: string;
  verdict: SkillVerdict;
  severity: ScanSeverity;
  findingsCount: number;
  r2Key: string | null;
  reportKey: string;
  scanResult: SkillScanResult;
  scannedAt: string;
  metadata?: SkillRecordMetadata;
}

export interface D1Statement {
  sql: string;
  params: Array<string | number | null>;
}

export interface D1DatabaseClient {
  publishScanResult(payload: PublishDatabasePayload): Promise<void>;
}

export interface CloudflareD1ClientConfig {
  accountId: string;
  apiToken: string;
  databaseId: string;
  fetchImpl?: typeof fetch;
}

export function buildSkillId(source: SkillSource, slug: string) {
  return `${source}:${slug}`;
}

export function buildD1Statements(payload: PublishDatabasePayload): D1Statement[] {
  const skillId = buildSkillId(payload.source, payload.slug);
  const serializedMetadata = serializeMetadata(payload.metadata?.metadata);
  const metadataName = payload.metadata?.name ?? payload.slug;
  const metadataDescription = payload.metadata?.description ?? null;
  const metadataAuthor = payload.metadata?.author ?? null;
  const metadataInstalls = payload.metadata?.installs ?? 0;
  const metadataLatestVersion = payload.metadata?.latestVersion ?? payload.version;

  return [
    {
      sql: [
        'INSERT INTO skills (',
        '  id, source, slug, name, description, author, latest_version, latest_scanned_version,',
        '  verdict, scan_severity, findings_count, installs, first_seen_at, last_scanned_at,',
        '  last_updated_at, r2_key, report_r2_key, metadata',
        ') VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        'ON CONFLICT(id) DO UPDATE SET',
        '  name = excluded.name,',
        '  description = excluded.description,',
        '  author = excluded.author,',
        '  latest_version = excluded.latest_version,',
        '  latest_scanned_version = excluded.latest_scanned_version,',
        '  verdict = excluded.verdict,',
        '  scan_severity = excluded.scan_severity,',
        '  findings_count = excluded.findings_count,',
        '  installs = excluded.installs,',
        '  last_scanned_at = excluded.last_scanned_at,',
        '  last_updated_at = excluded.last_updated_at,',
        '  r2_key = excluded.r2_key,',
        '  report_r2_key = excluded.report_r2_key,',
        '  metadata = excluded.metadata',
      ].join(' '),
      params: [
        skillId,
        payload.source,
        payload.slug,
        metadataName,
        metadataDescription,
        metadataAuthor,
        metadataLatestVersion,
        payload.version,
        payload.verdict,
        payload.severity,
        payload.findingsCount,
        metadataInstalls,
        payload.scannedAt,
        payload.scannedAt,
        payload.scannedAt,
        payload.r2Key,
        payload.reportKey,
        serializedMetadata,
      ],
    },
    {
      sql: [
        'INSERT INTO scan_runs (',
        '  id, skill_id, version, started_at, completed_at, status, verdict, severity,',
        '  findings_count, findings, scanner_version, analyzers_used, error',
        ') VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        'ON CONFLICT(skill_id, version) DO UPDATE SET',
        '  completed_at = excluded.completed_at,',
        '  status = excluded.status,',
        '  verdict = excluded.verdict,',
        '  severity = excluded.severity,',
        '  findings_count = excluded.findings_count,',
        '  findings = excluded.findings,',
        '  scanner_version = excluded.scanner_version,',
        '  analyzers_used = excluded.analyzers_used,',
        '  error = excluded.error'
      ].join(' '),
      params: [
        `${skillId}:${payload.version}`,
        skillId,
        payload.version,
        payload.scannedAt,
        payload.scannedAt,
        'completed',
        payload.verdict,
        payload.severity,
        payload.findingsCount,
        JSON.stringify(payload.scanResult.findings),
        payload.scanResult.scannerVersion,
        JSON.stringify(payload.scanResult.analyzersUsed),
        null,
      ],
    },
  ];
}

export function createCloudflareD1Client(config: CloudflareD1ClientConfig): D1DatabaseClient {
  const fetchImpl = config.fetchImpl ?? fetch;

  return {
    async publishScanResult(payload) {
      const statements = buildD1Statements(payload);

      for (const statement of statements) {
        const response = await fetchImpl(buildCloudflareD1Url(config), {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${config.apiToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(statement),
        });

        if (!response.ok) {
          const responseBody = await response.text().catch(() => '');
          const details = responseBody.trim();
          throw new Error(
            details.length > 0
              ? `D1 publish failed with status ${response.status}: ${details}`
              : `D1 publish failed with status ${response.status}`,
          );
        }
      }
    },
  };
}

function buildCloudflareD1Url(config: CloudflareD1ClientConfig) {
  return `https://api.cloudflare.com${CLOUDFLARE_D1_QUERY_PATH}/${config.accountId}/d1/database/${config.databaseId}/query`;
}

function serializeMetadata(metadata: Record<string, unknown> | undefined) {
  if (!metadata || Object.keys(metadata).length === 0) {
    return null;
  }

  return JSON.stringify(metadata);
}
