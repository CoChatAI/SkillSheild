import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { scanJobLocatorSchema } from '@skillshield/shared';
import {
  createDefaultAdapters,
  executeScanJob,
  parseSource,
  runFullSourceScrape,
  type ServiceDependencies,
} from './service';
import {
  persistInstallCounts,
  scrapeSkillsShInstalls,
  type CloudflareD1Config,
} from './installs-scraper';

interface ScannerAppDependencies extends ServiceDependencies {
  backgroundRunner?: (task: Promise<unknown>) => void;
  authToken?: string;
}

export function createScannerApp(dependencies: ScannerAppDependencies = {}) {
  const app = new Hono();
  const serviceDependencies: ServiceDependencies = {
    ...dependencies,
    adapters: dependencies.adapters ?? createDefaultAdapters(),
  };
  const backgroundRunner = dependencies.backgroundRunner ?? defaultBackgroundRunner;
  const authToken = normalizeOptionalString(dependencies.authToken ?? process.env.SCANNER_AUTH_TOKEN);

  app.get('/health', (c) => c.json({ status: 'ok', service: 'skillshield-scanner' }));

  app.post('/scan', async (c) => {
    try {
      authorizeMutationRequest(c.req.header('authorization'), authToken);
      const body = await c.req.json();
      const parsedBody = scanJobLocatorSchema.safeParse(body);

      if (!parsedBody.success) {
        throw new Error(parsedBody.error.issues[0]?.message ?? 'Invalid scan job payload.');
      }

      const result = await executeScanJob(parsedBody.data, serviceDependencies);

      return c.json({
        success: true,
        ...result,
      });
    } catch (error) {
      return handleRouteError(c, error);
    }
  });

  app.post('/scrape-installs', async (c) => {
    try {
      authorizeMutationRequest(c.req.header('authorization'), authToken);
      const d1Config = readCloudflareD1ConfigFromEnv();
      const scrapeResult = await scrapeSkillsShInstalls();
      const persistResult = await persistInstallCounts(d1Config, scrapeResult.records, {
        scrapedAt: scrapeResult.scrapedAt,
      });

      return c.json({
        started: true,
        completed: true,
        scraped: scrapeResult.records.length,
        attempted: persistResult.attempted,
        updated: persistResult.updated,
        scrapedAt: scrapeResult.scrapedAt,
      });
    } catch (error) {
      return handleRouteError(c, error);
    }
  });

  app.post('/scrape/:source', async (c) => {
    try {
      authorizeMutationRequest(c.req.header('authorization'), authToken);
      const source = parseSource(c.req.param('source'));
      const waitForCompletion = c.req.query('wait') === 'true';
      const limit = parseOptionalInteger(c.req.query('limit'));
      const delayMs = parseOptionalInteger(c.req.query('delayMs'));
      const useLlm = parseOptionalBoolean(c.req.query('useLlm'));
      const scrapeTask = runFullSourceScrape(source, {
        limit,
        interSkillDelayMs: delayMs,
        scanOptions: typeof useLlm === 'boolean' ? { useLlm } : undefined,
      }, serviceDependencies);

      if (waitForCompletion) {
        const result = await scrapeTask;
        return c.json({ started: true, ...result });
      }

      backgroundRunner(scrapeTask);

      return c.json({
        started: true,
        completed: false,
        source,
        limit: limit ?? null,
      });
    } catch (error) {
      return handleRouteError(c, error);
    }
  });

  return app;
}

if (process.env.NODE_ENV !== 'test') {
  serve({ fetch: createScannerApp().fetch, port: resolveServerPort() });
}

function resolveServerPort() {
  const rawPort = process.env.PORT?.trim();

  if (!rawPort) {
    return 3100;
  }

  const parsedPort = Number.parseInt(rawPort, 10);
  if (!Number.isInteger(parsedPort) || parsedPort <= 0) {
    throw new Error(`Invalid PORT value: ${rawPort}`);
  }

  return parsedPort;
}

function defaultBackgroundRunner(task: Promise<unknown>) {
  task.catch((error) => {
    console.error('[scrape] Background scrape failed', error);
  });
}

function readCloudflareD1ConfigFromEnv(): CloudflareD1Config {
  const accountId = requireEnv('CF_ACCOUNT_ID');
  const apiToken = requireEnv('CF_API_TOKEN');
  const databaseId = requireEnv('D1_DATABASE_ID');
  return { accountId, apiToken, databaseId };
}

function requireEnv(name: string) {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function parseOptionalInteger(value: string | undefined) {
  if (!value) {
    return undefined;
  }

  const parsedValue = Number.parseInt(value, 10);

  if (!Number.isInteger(parsedValue) || parsedValue < 0) {
    throw new Error(`Invalid integer value: ${value}`);
  }

  return parsedValue;
}

function parseOptionalBoolean(value: string | undefined) {
  if (value === undefined) {
    return undefined;
  }

  if (value === 'true') {
    return true;
  }

  if (value === 'false') {
    return false;
  }

  throw new Error(`Invalid boolean value: ${value}`);
}

function authorizeMutationRequest(authorizationHeader: string | undefined, authToken: string | undefined) {
  if (!authToken) {
    return;
  }

  if (authorizationHeader !== `Bearer ${authToken}`) {
    throw new Error('Unauthorized scanner mutation request.');
  }
}

function normalizeOptionalString(value: string | undefined) {
  const trimmedValue = value?.trim();
  return trimmedValue ? trimmedValue : undefined;
}

function handleRouteError(c: { json: (body: unknown, status?: number) => Response }, error: unknown) {
  const message = error instanceof Error ? error.message : 'Unknown scanner route failure';
  const status = message.startsWith('Unauthorized scanner mutation request.')
    ? 401
    : message.startsWith('Unknown source:')
    || message.startsWith('Source not configured yet:')
    || message.startsWith('Scan jobs require either a slug or repo field.')
    || message.startsWith('Invalid ')
    || error instanceof SyntaxError
    ? 400
    : 500;

  return c.json({ success: false, error: message }, status);
}
