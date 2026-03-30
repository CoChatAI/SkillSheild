import { describe, expect, it } from 'vitest';
import app from '../src/index';

describe('worker health route', () => {
  it('returns the planned JSON payload', async () => {
    const response = await app.request('http://localhost/health');

    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    await expect(response.json()).resolves.toEqual({
      status: 'ok',
      service: 'skillshield',
    });
  });
});
