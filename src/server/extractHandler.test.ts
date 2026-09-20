import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ExtractionOutcome, ProcessedMedia } from '@/core/extraction/service';

const extractWorkoutWithClaude = vi.fn<
  (media: ProcessedMedia, config: { apiKey: string }) => Promise<ExtractionOutcome>
>();

vi.mock('./anthropicExtractor', () => ({ extractWorkoutWithClaude }));

const { handleExtractRequest: POST } = await import('./extractHandler');

function body(overrides: Record<string, unknown> = {}) {
  return {
    sourceContentId: 'src_1',
    source: { platform: 'upload' },
    mediaAnalyzed: true,
    transcript: [],
    onScreenText: [],
    frames: [{ atSeconds: 1, base64: 'AAAA', mediaType: 'image/jpeg' }],
    ...overrides,
  };
}

function post(payload: unknown, headers: Record<string, string> = {}) {
  return new Request('https://example.invalid/api/extract', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: typeof payload === 'string' ? payload : JSON.stringify(payload),
  });
}

beforeEach(() => {
  extractWorkoutWithClaude.mockReset();
  extractWorkoutWithClaude.mockResolvedValue({
    status: 'no_workout_detected',
    detectedMovements: [],
  });
  process.env.ANTHROPIC_API_KEY = 'sk-ant-test';
});

describe('POST /api/extract', () => {
  it('extracts from a well-formed request', async () => {
    extractWorkoutWithClaude.mockResolvedValue({
      status: 'ok',
      result: {
        title: 'Leg Day',
        structure: 'circuit',
        blocks: [],
        workoutNotes: [],
        detectedMovements: [],
      },
    });

    const response = await POST(post(body()));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ status: 'ok' });
  });

  it('reports a failure as a 200 with a typed body, not an HTTP error', async () => {
    // "We found fitness content but no workout" is a product state the client
    // renders, not a transport failure.
    extractWorkoutWithClaude.mockResolvedValue({
      status: 'no_workout_detected',
      detectedMovements: ['Push Up'],
    });

    const response = await POST(post(body()));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ status: 'no_workout_detected' });
  });

  it('refuses to run when the server has no key configured', async () => {
    delete process.env.ANTHROPIC_API_KEY;
    const response = await POST(post(body()));

    expect(response.status).toBe(503);
    const payload = await response.json();
    expect(payload.retryable).toBe(false);
    // Never describe our own configuration to a caller.
    expect(JSON.stringify(payload)).not.toMatch(/key|env|ANTHROPIC/i);
    expect(extractWorkoutWithClaude).not.toHaveBeenCalled();
  });

  it('rejects a malformed body without reaching the model', async () => {
    expect((await POST(post('not json'))).status).toBe(400);
    expect((await POST(post({ sourceContentId: 'x' }))).status).toBe(400);
    expect(extractWorkoutWithClaude).not.toHaveBeenCalled();
  });

  it('rejects an oversized payload before reading it', async () => {
    const response = await POST(post(body(), { 'content-length': String(50 * 1024 * 1024) }));
    expect(response.status).toBe(413);
    expect(extractWorkoutWithClaude).not.toHaveBeenCalled();
  });

  it('rejects more frames than it will accept', async () => {
    const tooMany = Array.from({ length: 30 }, (_, i) => ({
      atSeconds: i,
      base64: 'AAAA',
      mediaType: 'image/jpeg',
    }));
    expect((await POST(post(body({ frames: tooMany })))).status).toBe(400);
  });

  it('derives mediaAnalyzed from what arrived rather than trusting the client', async () => {
    await POST(post(body({ mediaAnalyzed: true, frames: [], transcript: [] })));

    const media = extractWorkoutWithClaude.mock.calls[0]?.[0];
    expect(media?.mediaAnalyzed).toBe(false);
  });

  it('passes the server-held key to the extractor', async () => {
    await POST(post(body()));
    expect(extractWorkoutWithClaude.mock.calls[0]?.[1].apiKey).toBe('sk-ant-test');
  });
});
