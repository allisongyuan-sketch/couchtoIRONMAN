import { describe, expect, it, vi } from 'vitest';
import { RemoteExtractionService } from './remoteExtractionService';
import { emptyProcessedMedia, type ProcessedMedia } from './service';

function media(overrides: Partial<ProcessedMedia> = {}): ProcessedMedia {
  return {
    ...emptyProcessedMedia('src_1', { platform: 'upload' }),
    mediaAnalyzed: true,
    frames: [{ atSeconds: 1, base64: 'AAAA', mediaType: 'image/jpeg' }],
    ...overrides,
  };
}

function serviceReturning(body: unknown, status = 200) {
  const fetchImpl = vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response);

  return {
    fetchImpl,
    service: new RemoteExtractionService({
      endpoint: 'https://example.invalid/api/extract',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    }),
  };
}

describe('RemoteExtractionService', () => {
  it('passes a successful outcome straight through', async () => {
    const { service } = serviceReturning({
      status: 'ok',
      result: { title: 'X', structure: 'circuit', blocks: [], workoutNotes: [], detectedMovements: [] },
    });
    expect((await service.extractWorkout(media())).status).toBe('ok');
  });

  it('sends evidence and frames, and no credential', async () => {
    const { service, fetchImpl } = serviceReturning({ status: 'no_workout_detected', detectedMovements: [] });
    await service.extractWorkout(media({ captionText: 'leg day' }));

    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(url).toBe('https://example.invalid/api/extract');

    const body = JSON.parse((init as RequestInit).body as string);
    expect(body.frames).toHaveLength(1);
    expect(body.captionText).toBe('leg day');

    // The device must never carry an API key. If one ever shows up in this request
    // it means someone moved the model call back onto the client.
    const headers = JSON.stringify((init as RequestInit).headers ?? {});
    expect(headers.toLowerCase()).not.toContain('authorization');
    expect(headers.toLowerCase()).not.toContain('x-api-key');
  });

  it('does not call the endpoint when there is nothing to analyze', async () => {
    const { service, fetchImpl } = serviceReturning({ status: 'ok' });
    const outcome = await service.extractWorkout(
      emptyProcessedMedia('src_1', { platform: 'tiktok' }),
    );

    expect(outcome).toMatchObject({ status: 'failed', retryable: false });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('treats a too-large payload as a clear, non-retryable failure', async () => {
    const { service } = serviceReturning({}, 413);
    const outcome = await service.extractWorkout(media());
    expect(outcome).toMatchObject({ status: 'failed', retryable: false });
    if (outcome.status !== 'failed') return;
    expect(outcome.reason).toContain('too large');
  });

  it('marks server errors retryable and client errors not', async () => {
    expect(await serviceReturning({}, 503).service.extractWorkout(media())).toMatchObject({
      retryable: true,
    });
    expect(await serviceReturning({}, 429).service.extractWorkout(media())).toMatchObject({
      retryable: true,
    });
    expect(await serviceReturning({}, 400).service.extractWorkout(media())).toMatchObject({
      retryable: false,
    });
  });

  it('rejects a response envelope it does not recognise', async () => {
    const { service } = serviceReturning({ unexpected: true });
    expect(await service.extractWorkout(media())).toMatchObject({
      status: 'failed',
      retryable: true,
    });
  });

  it('surfaces a network failure as retryable', async () => {
    const service = new RemoteExtractionService({
      endpoint: 'https://example.invalid/api/extract',
      fetchImpl: (() => Promise.reject(new Error('network down'))) as unknown as typeof fetch,
    });
    expect(await service.extractWorkout(media())).toMatchObject({
      status: 'failed',
      retryable: true,
    });
  });

  it('gives up rather than hanging forever', async () => {
    // A request that never resolves would strand the user on "Creating your
    // workout…" with no way back.
    const service = new RemoteExtractionService({
      endpoint: 'https://example.invalid/api/extract',
      timeoutMs: 10,
      fetchImpl: ((_url: string, init: RequestInit) =>
        new Promise((_resolve, reject) => {
          init.signal?.addEventListener('abort', () => {
            const error = new Error('aborted');
            error.name = 'AbortError';
            reject(error);
          });
        })) as unknown as typeof fetch,
    });

    const outcome = await service.extractWorkout(media());
    expect(outcome).toMatchObject({ status: 'failed', retryable: true });
    if (outcome.status !== 'failed') return;
    expect(outcome.reason).toContain('too long');
  });

  it('honours a caller cancelling the import', async () => {
    const controller = new AbortController();
    const service = new RemoteExtractionService({
      endpoint: 'https://example.invalid/api/extract',
      fetchImpl: ((_url: string, init: RequestInit) =>
        new Promise((_resolve, reject) => {
          init.signal?.addEventListener('abort', () => {
            const error = new Error('aborted');
            error.name = 'AbortError';
            reject(error);
          });
        })) as unknown as typeof fetch,
    });

    const pending = service.extractWorkout(media(), { signal: controller.signal });
    controller.abort();

    expect(await pending).toMatchObject({ status: 'failed', reason: 'Extraction was cancelled' });
  });
});
