import type { QueuedScanJob } from '@skillshield/shared';
import type {
  ScrapeJobRecordInput,
  ScrapeJobRecordResult,
  ScrapeQueueDependencies,
  ScrapeRunRecordInput,
  ScrapeRunRecordResult,
} from './service';

type HttpScrapeQueueOptions = {
  baseUrl: string;
  authToken?: string;
  fetchImpl?: typeof fetch;
};

export function createHttpScrapeQueue(options: HttpScrapeQueueOptions): ScrapeQueueDependencies {
  const baseUrl = normalizeBaseUrl(options.baseUrl);
  const fetchImpl = options.fetchImpl ?? fetch;

  return {
    createScrapeRun: (input) => postJson<ScrapeRunRecordResult>(fetchImpl, baseUrl, '/api/v1/scrape-runs', input, options.authToken),
    createScrapeJob: (input) => postJson<ScrapeJobRecordResult>(
      fetchImpl,
      baseUrl,
      `/api/v1/scrape-runs/${encodeURIComponent(input.runId)}/jobs`,
      input,
      options.authToken,
    ),
    enqueueScanJob: (job) => postJson(fetchImpl, baseUrl, '/api/v1/scan-queue', job, options.authToken),
    refreshScrapeRunCounters: (runId) => postJson(
      fetchImpl,
      baseUrl,
      `/api/v1/scrape-runs/${encodeURIComponent(runId)}/refresh-counters`,
      {},
      options.authToken,
    ),
  } satisfies ScrapeQueueDependencies;
}

export function createHttpScrapeQueueFromEnv(env: NodeJS.ProcessEnv = process.env) {
  const baseUrl = normalizeOptionalString(env.SCRAPE_QUEUE_BASE_URL ?? env.SKILLS_API_URL);
  if (!baseUrl) {
    return undefined;
  }

  return createHttpScrapeQueue({
    baseUrl,
    authToken: normalizeOptionalString(env.SCRAPE_QUEUE_AUTH_TOKEN ?? env.SCANNER_AUTH_TOKEN ?? env.WEBHOOK_SECRET),
  });
}

async function postJson<TResponse = void>(
  fetchImpl: typeof fetch,
  baseUrl: string,
  path: string,
  body: ScrapeRunRecordInput | ScrapeJobRecordInput | QueuedScanJob | Record<string, never>,
  authToken: string | undefined,
): Promise<TResponse> {
  const response = await fetchImpl(new URL(path, baseUrl), {
    method: 'POST',
    headers: buildHeaders(authToken),
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errorBody = await response.text().catch(() => '');
    throw new Error(`Scrape queue API request failed for ${path} (${response.status}): ${errorBody || response.statusText}`);
  }

  if (response.status === 204) {
    return undefined as TResponse;
  }

  return response.json() as Promise<TResponse>;
}

function buildHeaders(authToken: string | undefined) {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };

  if (authToken) {
    headers.Authorization = `Bearer ${authToken}`;
  }

  return headers;
}

function normalizeBaseUrl(value: string) {
  return value.endsWith('/') ? value : `${value}/`;
}

function normalizeOptionalString(value: string | undefined) {
  const trimmedValue = value?.trim();
  return trimmedValue ? trimmedValue : undefined;
}
