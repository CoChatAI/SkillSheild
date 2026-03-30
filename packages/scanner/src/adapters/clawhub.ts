import { CLAWHUB_REGISTRY_URL } from '@skillshield/shared';
import { join } from 'node:path';
import {
  downloadResponseToFile,
  execFileAsync,
  fetchJson,
  makeTempDir,
  type FetchLike,
} from '../utils';

export interface ClawHubSkillListItem {
  slug: string;
  name: string;
  latestVersion?: string;
}

interface ClawHubListResponse {
  skills?: Array<{
    slug?: unknown;
    name?: unknown;
    versions?: {
      latest?: unknown;
    };
  }>;
  nextCursor?: unknown;
}

interface ClawHubAdapterOptions {
  registry?: string;
  fetch?: FetchLike;
  sleep?: (milliseconds: number) => Promise<void>;
  extractZip?: (zipPath: string, destinationDir: string) => Promise<void>;
}

export class ClawHubAdapter {
  readonly source = 'clawhub';

  private readonly registry: string;
  private readonly fetchImpl: FetchLike;
  private readonly sleep: (milliseconds: number) => Promise<void>;
  private readonly extractZip: (zipPath: string, destinationDir: string) => Promise<void>;

  constructor(options: ClawHubAdapterOptions = {}) {
    this.registry = stripTrailingSlash(options.registry ?? CLAWHUB_REGISTRY_URL);
    this.fetchImpl = options.fetch ?? fetch;
    this.sleep = options.sleep ?? defaultSleep;
    this.extractZip = options.extractZip ?? unzipArchive;
  }

  async listAll(): Promise<ClawHubSkillListItem[]> {
    const skills: ClawHubSkillListItem[] = [];
    let nextCursor: string | undefined;

    while (true) {
      const pageUrl = new URL(`${this.registry}/api/v1/skills`);
      pageUrl.searchParams.set('limit', '100');

      if (nextCursor) {
        pageUrl.searchParams.set('cursor', nextCursor);
      }

      const payload = await fetchJson<ClawHubListResponse>(this.fetchImpl, pageUrl.toString());
      const pageSkills = normalizeListPage(payload, pageUrl.toString());
      skills.push(...pageSkills);

      nextCursor = normalizeCursor(payload.nextCursor);
      if (!nextCursor) {
        return skills;
      }

      await this.sleep(200);
    }
  }

  async fetch(slug: string, version?: string): Promise<string> {
    if (!slug) {
      throw new Error('ClawHub fetch requires a non-empty slug.');
    }

    const downloadUrl = new URL(`${this.registry}/api/v1/download`);
    downloadUrl.searchParams.set('slug', slug);

    if (version) {
      downloadUrl.searchParams.set('version', version);
    }

    const destinationDir = await makeTempDir(`clawhub-${slug}`);
    const archivePath = join(destinationDir, `${slugToFileName(slug)}.zip`);
    const response = await this.fetchImpl(downloadUrl.toString());

    await downloadResponseToFile(response, archivePath);
    await this.extractZip(archivePath, destinationDir);

    return destinationDir;
  }
}

function normalizeListPage(payload: ClawHubListResponse, requestUrl: string) {
  if (!payload || typeof payload !== 'object') {
    throw new Error(`ClawHub returned an invalid list response for ${requestUrl}.`);
  }

  if (!Array.isArray(payload.skills)) {
    throw new Error(`ClawHub list response is missing a skills array for ${requestUrl}.`);
  }

  return payload.skills.map((skill, index) => {
    if (!skill || typeof skill !== 'object') {
      throw new Error(`ClawHub skill entry ${index} is invalid for ${requestUrl}.`);
    }

    if (typeof skill.slug !== 'string' || skill.slug.length === 0) {
      throw new Error(`ClawHub skill entry ${index} is missing slug for ${requestUrl}.`);
    }

    if (typeof skill.name !== 'string' || skill.name.length === 0) {
      throw new Error(`ClawHub skill entry ${index} is missing name for ${requestUrl}.`);
    }

    const latestVersion = skill.versions?.latest;
    return {
      slug: skill.slug,
      name: skill.name,
      latestVersion: typeof latestVersion === 'string' ? latestVersion : undefined,
    } satisfies ClawHubSkillListItem;
  });
}

function normalizeCursor(cursor: unknown) {
  if (typeof cursor !== 'string' || cursor.length === 0) {
    return undefined;
  }

  return cursor;
}

function stripTrailingSlash(value: string) {
  return value.replace(/\/+$/, '');
}

function slugToFileName(slug: string) {
  return slug.replace(/[^a-z0-9-]/gi, '-');
}

function defaultSleep(milliseconds: number) {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}

async function unzipArchive(zipPath: string, destinationDir: string) {
  await execFileAsync('unzip', ['-o', zipPath, '-d', destinationDir]);
}
