import { execFile, type ExecFileOptions } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { promisify } from 'node:util';

const execFilePromise = promisify(execFile);

export type FetchLike = typeof fetch;

export async function execFileAsync(
  file: string,
  args: readonly string[],
  options?: ExecFileOptions,
) {
  return execFilePromise(file, [...args], options);
}

export async function makeTempDir(prefix: string) {
  const safePrefix = prefix.replace(/[^a-z0-9-]/gi, '-');
  return mkdtemp(join(tmpdir(), `${safePrefix}-`));
}

export async function fetchJson<T>(
  fetchImpl: FetchLike,
  url: string,
  init?: RequestInit,
): Promise<T> {
  const response = await fetchImpl(url, init);

  if (!response.ok) {
    throw new Error(await buildHttpErrorMessage(response, url));
  }

  return (await response.json()) as T;
}

export async function downloadResponseToFile(response: Response, destinationPath: string) {
  if (!response.ok) {
    throw new Error(await buildHttpErrorMessage(response));
  }

  if (!response.body) {
    throw new Error('Received empty response body while downloading skill archive.');
  }

  await pipeline(
    Readable.fromWeb(response.body as any),
    createWriteStream(destinationPath),
  );
}

async function buildHttpErrorMessage(response: Response, url?: string) {
  const body = await response.text().catch(() => '');
  const bodySummary = body.trim().slice(0, 200);
  const parts = [
    `Request failed with status ${response.status}`,
    url ? `for ${url}` : undefined,
    bodySummary ? `: ${bodySummary}` : undefined,
  ].filter(Boolean);

  return parts.join(' ');
}
