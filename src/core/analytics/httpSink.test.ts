import { describe, expect, it, vi } from 'vitest';
import { HttpAnalyticsSink } from './httpSink';
import type { DeliverableEvent } from './transport';

const events: DeliverableEvent[] = [
  {
    name: 'import_succeeded',
    at: 1_700_000_000_000,
    deviceId: 'dev_1',
    properties: { platform: 'tiktok', durationMs: 4200, exerciseCount: 3 },
  },
];

function sinkReturning(status: number) {
  const fetchImpl = vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
  } as Response);

  return {
    fetchImpl,
    sink: new HttpAnalyticsSink({
      endpoint: 'https://collector.invalid/batch/',
      apiKey: 'phc_write_only',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    }),
  };
}

describe('HttpAnalyticsSink', () => {
  it('posts a batch in capture format', async () => {
    const { sink, fetchImpl } = sinkReturning(200);
    expect(await sink.send(events)).toBe(true);

    const body = JSON.parse((fetchImpl.mock.calls[0]![1] as RequestInit).body as string);
    expect(body.api_key).toBe('phc_write_only');
    expect(body.batch).toHaveLength(1);
    expect(body.batch[0]).toMatchObject({
      event: 'import_succeeded',
      distinct_id: 'dev_1',
      properties: { platform: 'tiktok' },
    });
    // Timestamps go out as ISO, from when the event happened.
    expect(body.batch[0].timestamp).toBe('2023-11-14T22:13:20.000Z');
  });

  it('sends nothing for an empty batch', async () => {
    const { sink, fetchImpl } = sinkReturning(200);
    expect(await sink.send([])).toBe(true);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('asks to keep the batch when the collector is down', async () => {
    expect(await sinkReturning(503).sink.send(events)).toBe(false);
    expect(await sinkReturning(429).sink.send(events)).toBe(false);
  });

  it('drops a batch the collector will never accept', async () => {
    // A 400 or a bad key will fail identically forever. Retrying would block every
    // later event behind a batch that can never succeed.
    expect(await sinkReturning(400).sink.send(events)).toBe(true);
    expect(await sinkReturning(401).sink.send(events)).toBe(true);
  });

  it('keeps the batch on a network failure', async () => {
    const sink = new HttpAnalyticsSink({
      endpoint: 'https://collector.invalid/batch/',
      apiKey: 'k',
      fetchImpl: (() => Promise.reject(new Error('offline'))) as unknown as typeof fetch,
    });
    expect(await sink.send(events)).toBe(false);
  });

  it('gives up on a collector that never responds', async () => {
    const sink = new HttpAnalyticsSink({
      endpoint: 'https://collector.invalid/batch/',
      apiKey: 'k',
      timeoutMs: 10,
      fetchImpl: ((_url: string, init: RequestInit) =>
        new Promise((_resolve, reject) => {
          init.signal?.addEventListener('abort', () => reject(new Error('aborted')));
        })) as unknown as typeof fetch,
    });

    expect(await sink.send(events)).toBe(false);
  });
});
