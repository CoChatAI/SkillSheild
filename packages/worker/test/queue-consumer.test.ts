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

  it('marks tracked scrape jobs running and completed around dispatch', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ success: true }), { status: 200 }));
    const database = createRecordingDatabase();
    const job = createQueuedJob({ run_id: 'run-1', job_id: 'job-1' });
    const message = createQueueMessage(job);

    vi.stubGlobal('fetch', fetchMock);
    await consumeScanQueue(createBatch(message) as QueueConsumerBatch, createEnv({ database }));

    expect(database.statements.map((statement) => statement.params[0])).toEqual([
      'running',
      'running',
      'run-1',
      'completed',
      'run-1',
      'run-1',
    ]);
    expect(message.ack).toHaveBeenCalledTimes(1);
  });

  it('acks disabled source jobs without forwarding them', async () => {
    const fetchMock = vi.fn();
    const database = createRecordingDatabase();
    const message = createQueueMessage(createQueuedJob({ run_id: 'run-1', job_id: 'job-1' }));

    vi.stubGlobal('fetch', fetchMock);
    await consumeScanQueue(createBatch(message) as QueueConsumerBatch, createEnv({ database, disabledSources: 'clawhub' }));

    expect(fetchMock).not.toHaveBeenCalled();
    expect(database.statements[0]?.params[0]).toBe('failed');
    expect(database.statements[0]?.params[4]).toBe('Source is disabled: clawhub');
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

  it('marks tracked scrape jobs retrying when dispatch fails', async () => {
    const fetchMock = vi.fn(async () => new Response('upstream error', { status: 502 }));
    const database = createRecordingDatabase();
    const message = createQueueMessage(createQueuedJob({ run_id: 'run-1', job_id: 'job-1' }));

    vi.stubGlobal('fetch', fetchMock);
    await consumeScanQueue(createBatch(message) as QueueConsumerBatch, createEnv({ database }));

    expect(database.statements.map((statement) => statement.params[0])).toEqual([
      'running',
      'running',
      'run-1',
      'retrying',
      'run-1',
      'run-1',
    ]);
    expect(message.retry).toHaveBeenCalledTimes(1);
  });

  it('marks tracked scrape jobs failed on the configured final attempt', async () => {
    const fetchMock = vi.fn(async () => new Response('upstream error', { status: 502 }));
    const database = createRecordingDatabase();
    const message = createQueueMessage(createQueuedJob({ run_id: 'run-1', job_id: 'job-1' }), { attempts: 9 });

    vi.stubGlobal('fetch', fetchMock);
    await consumeScanQueue(createBatch(message) as QueueConsumerBatch, createEnv({ database }));

    expect(database.statements[3]?.params[0]).toBe('failed');
    expect(message.retry).toHaveBeenCalledTimes(1);
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

function createEnv(options: { scannerAuthToken?: string; database?: D1Database; disabledSources?: string } = {}): WorkerBindings {
  return {
    DB: options.database ?? ({} as never),
    SKILLS_BUCKET: {} as never,
    REPORTS_BUCKET: {} as never,
    META_BUCKET: {} as never,
    SCAN_QUEUE: {} as never,
    SCANNER_BASE_URL: 'https://skillshield-scanner.fly.dev',
    SCANNER_REQUEST_TIMEOUT_MS: '30000',
    SCAN_QUEUE_MAX_ATTEMPTS: '9',
    DISABLED_SOURCES: options.disabledSources,
    SCANNER_AUTH_TOKEN: options.scannerAuthToken,
    ENVIRONMENT: 'test',
  };
}

function createQueuedJob(overrides: Partial<QueuedScanJob> = {}): QueuedScanJob {
  return {
    type: 'scan',
    source: 'clawhub',
    slug: 'acme/trello',
    version: '1.2.3',
    owner: 'Acme',
    triggered_by: 'webhook',
    event_id: 'event-123',
    ...overrides,
  };
}

function createRecordingDatabase() {
  const statements: Array<{ sql: string; params: unknown[] }> = [];

  return {
    statements,
    prepare(sql: string) {
      return {
        bind(...params: unknown[]) {
          statements.push({ sql, params });
          return this;
        },
        run: vi.fn(async () => ({ success: true }) as D1Result<unknown>),
      } as unknown as D1PreparedStatement;
    },
  } as D1Database & { statements: Array<{ sql: string; params: unknown[] }> };
}

function createBatch(message: QueueTestMessage): QueueTestBatch {
  return {
    queue: 'scan-jobs',
    messages: [message],
    ackAll: vi.fn(),
    retryAll: vi.fn(),
  };
}

function createQueueMessage(body: unknown, options: { attempts?: number } = {}): QueueTestMessage {
  return {
    id: 'message-1',
    timestamp: new Date('2026-03-30T12:15:00.000Z'),
    attempts: options.attempts ?? 1,
    body,
    ack: vi.fn(),
    retry: vi.fn(),
  };
}
