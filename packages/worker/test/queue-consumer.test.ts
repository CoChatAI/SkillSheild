import { describe, expect, it, vi } from 'vitest';
import { type QueuedScanJob } from '@skillshield/shared';
import worker, { consumeScanQueue } from '../src/index';
import type { WorkerBindings } from '../src/types';

type QueueTestMessage = {
  id: string;
  timestamp: Date;
  attempts: number;
  body: unknown;
  ack: ReturnType<typeof vi.fn>;
  retry: ReturnType<typeof vi.fn>;
};

type QueueTestBatch = {
  queue: string;
  messages: QueueTestMessage[];
  ackAll: ReturnType<typeof vi.fn>;
  retryAll: ReturnType<typeof vi.fn>;
};

type QueueConsumerBatch = Parameters<typeof consumeScanQueue>[0];

describe('worker queue consumer', () => {
  it('forwards validated scan jobs to the scanner', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      return new Response(JSON.stringify({ success: true }), { status: 200 });
    });
    const job = createQueuedJob();
    const message = createQueueMessage(job);

    vi.stubGlobal('fetch', fetchMock);
    await consumeScanQueue(createBatch(message) as QueueConsumerBatch, createEnv({ scannerAuthToken: 'scanner-secret' }));

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[0]).toBe('https://skillshield-scanner.fly.dev/scan');
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer scanner-secret',
      },
    });
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toEqual(job);
    expect(message.ack).toHaveBeenCalledTimes(1);
    expect(message.retry).not.toHaveBeenCalled();
  });

  it('retries a message when scanner forwarding fails', async () => {
    const fetchMock = vi.fn(async () => new Response('upstream error', { status: 502 }));
    const message = createQueueMessage(createQueuedJob());

    vi.stubGlobal('fetch', fetchMock);
    await worker.queue!(createBatch(message) as QueueConsumerBatch, createEnv(), {} as never);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(message.retry).toHaveBeenCalledTimes(1);
    expect(message.ack).not.toHaveBeenCalled();
  });

  it('drops invalid queue payloads without forwarding them', async () => {
    const fetchMock = vi.fn();
    const message = createQueueMessage({ source: 'clawhub' });

    vi.stubGlobal('fetch', fetchMock);
    await consumeScanQueue(createBatch(message) as QueueConsumerBatch, createEnv());

    expect(fetchMock).not.toHaveBeenCalled();
    expect(message.ack).toHaveBeenCalledTimes(1);
    expect(message.retry).not.toHaveBeenCalled();
  });
});

function createEnv(options: { scannerAuthToken?: string } = {}): WorkerBindings {
  return {
    DB: {} as never,
    SKILLS_BUCKET: {} as never,
    REPORTS_BUCKET: {} as never,
    META_BUCKET: {} as never,
    SCAN_QUEUE: {} as never,
    SCANNER_BASE_URL: 'https://skillshield-scanner.fly.dev',
    SCANNER_REQUEST_TIMEOUT_MS: '30000',
    SCANNER_AUTH_TOKEN: options.scannerAuthToken,
    ENVIRONMENT: 'test',
  };
}

function createQueuedJob(): QueuedScanJob {
  return {
    type: 'scan',
    source: 'clawhub',
    slug: 'acme/trello',
    version: '1.2.3',
    owner: 'Acme',
    triggered_by: 'webhook',
    event_id: 'event-123',
  };
}

function createBatch(message: QueueTestMessage): QueueTestBatch {
  return {
    queue: 'scan-jobs',
    messages: [message],
    ackAll: vi.fn(),
    retryAll: vi.fn(),
  };
}

function createQueueMessage(body: unknown): QueueTestMessage {
  return {
    id: 'message-1',
    timestamp: new Date('2026-03-30T12:15:00.000Z'),
    attempts: 1,
    body,
    ack: vi.fn(),
    retry: vi.fn(),
  };
}
