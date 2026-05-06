import { access, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ClawHubAdapter } from '../src/adapters/clawhub';

describe('ClawHubAdapter', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('lists all skills across paginated ClawHub responses', async () => {
    const sleep = vi.fn(async () => {});
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({
          items: [
            { name: 'trello', displayName: 'Trello', latestVersion: '1.2.0' },
            { name: 'github', displayName: 'GitHub', latestVersion: '4.0.1' },
          ],
          nextCursor: 'page-2',
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          items: [{ name: 'linear', displayName: 'Linear', latestVersion: '0.9.0' }],
        }),
      );

    const adapter = new ClawHubAdapter({
      registry: 'https://clawhub.example',
      fetch: fetchMock as typeof fetch,
      sleep,
    });

    const result = await adapter.listAll();

    expect(result).toEqual([
      { slug: 'trello', name: 'Trello', latestVersion: '1.2.0' },
      { slug: 'github', name: 'GitHub', latestVersion: '4.0.1' },
      { slug: 'linear', name: 'Linear', latestVersion: '0.9.0' },
    ]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      'https://clawhub.example/api/v1/packages?family=skill&limit=200',
      { headers: {} },
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      'https://clawhub.example/api/v1/packages?family=skill&limit=200&cursor=page-2',
      { headers: {} },
    );
    expect(sleep).toHaveBeenCalledTimes(1);
    expect(sleep).toHaveBeenCalledWith(500);
  });

  it('downloads an archive and extracts it into a temp directory', async () => {
    const extractZip = vi.fn(async (_zipPath: string, destinationDir: string) => {
      await writeFile(join(destinationDir, 'SKILL.md'), '# Trello\n');
    });
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(new Uint8Array([1, 2, 3, 4]), { status: 200 }));
    const adapter = new ClawHubAdapter({
      registry: 'https://clawhub.example',
      fetch: fetchMock as typeof fetch,
      extractZip,
    });

    const skillDir = await adapter.fetch('team/trello', '1.2.3');
    const zipPath = extractZip.mock.calls[0]?.[0];

    expect(fetchMock).toHaveBeenCalledWith(
      'https://clawhub.example/api/v1/download?slug=team%2Ftrello&version=1.2.3',
      { headers: {} },
    );
    expect(zipPath).toContain('team-trello.zip');
    await expect(access(zipPath)).resolves.toBeUndefined();
    expect(await readFile(zipPath)).toEqual(Buffer.from([1, 2, 3, 4]));
    await expect(readFile(join(skillDir, 'SKILL.md'), 'utf8')).resolves.toContain('Trello');
  });

  it('skips malformed list entries', async () => {
    const adapter = new ClawHubAdapter({
      registry: 'https://clawhub.example',
      fetch: vi
        .fn()
        .mockResolvedValueOnce(jsonResponse({ items: [{ displayName: 'Broken entry' }] }))
        .mockResolvedValueOnce(jsonResponse({ skills: [{ displayName: 'Broken entry' }] })) as typeof fetch,
    });

    await expect(adapter.listAll()).resolves.toEqual([]);
  });
});

function jsonResponse(body: unknown) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}
