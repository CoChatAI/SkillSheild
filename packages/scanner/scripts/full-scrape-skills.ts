export interface FullSkillsShScrapeScriptOptions {
  baseUrl?: string;
  wait?: boolean;
  limit?: number;
  useLlm?: boolean;
  delayMs?: number;
  fetchImpl?: typeof fetch;
}

export async function runFullSkillsShScrape(options: FullSkillsShScrapeScriptOptions = {}) {
  const fetchImpl = options.fetchImpl ?? fetch;
  const endpoint = buildFullSkillsShScrapeUrl(options);
  const response = await fetchImpl(endpoint, { method: 'POST' });
  const body = await response.json();

  return {
    endpoint,
    ok: response.ok,
    status: response.status,
    body,
  };
}

export function buildFullSkillsShScrapeUrl(options: Omit<FullSkillsShScrapeScriptOptions, 'fetchImpl'> = {}) {
  const url = new URL('/scrape/skills-sh', options.baseUrl ?? 'http://localhost:3100');

  if (options.wait !== undefined) {
    url.searchParams.set('wait', String(options.wait));
  }

  if (typeof options.limit === 'number') {
    url.searchParams.set('limit', String(options.limit));
  }

  if (typeof options.useLlm === 'boolean') {
    url.searchParams.set('useLlm', String(options.useLlm));
  }

  if (typeof options.delayMs === 'number') {
    url.searchParams.set('delayMs', String(options.delayMs));
  }

  return url.toString();
}

if (import.meta.url === new URL(process.argv[1] ?? '', 'file://').href) {
  const options = parseCliArgs(process.argv.slice(2));

  runFullSkillsShScrape(options)
    .then((result) => {
      console.log(JSON.stringify(result, null, 2));
      process.exit(result.ok ? 0 : 1);
    })
    .catch((error) => {
      console.error(error instanceof Error ? error.message : error);
      process.exit(1);
    });
}

function parseCliArgs(args: string[]): FullSkillsShScrapeScriptOptions {
  const options: FullSkillsShScrapeScriptOptions = {};

  for (const arg of args) {
    if (arg.startsWith('--base-url=')) {
      options.baseUrl = arg.slice('--base-url='.length);
      continue;
    }

    if (arg.startsWith('--wait=')) {
      options.wait = parseBoolean(arg.slice('--wait='.length));
      continue;
    }

    if (arg.startsWith('--limit=')) {
      options.limit = parseInteger(arg.slice('--limit='.length));
      continue;
    }

    if (arg.startsWith('--use-llm=')) {
      options.useLlm = parseBoolean(arg.slice('--use-llm='.length));
      continue;
    }

    if (arg.startsWith('--delay-ms=')) {
      options.delayMs = parseInteger(arg.slice('--delay-ms='.length));
      continue;
    }

    throw new Error(`Unknown argument: ${arg}`);
  }

  return options;
}

function parseBoolean(value: string) {
  if (value === 'true') {
    return true;
  }

  if (value === 'false') {
    return false;
  }

  throw new Error(`Expected boolean but received: ${value}`);
}

function parseInteger(value: string) {
  const parsedValue = Number.parseInt(value, 10);

  if (!Number.isInteger(parsedValue) || parsedValue < 0) {
    throw new Error(`Expected non-negative integer but received: ${value}`);
  }

  return parsedValue;
}
