import { describe, expect, it, vi } from 'vitest';
import { handleTranscribeRequest } from './transcribeHandler';
import type { TranscriptionOutcome, TranscriptionService } from '@/core/transcription/types';

function stubService(outcome: TranscriptionOutcome) {
  const transcribe = vi.fn<TranscriptionService['transcribe']>().mockResolvedValue(outcome);
  return { transcribe, service: { id: 'stub', transcribe } satisfies TranscriptionService };
}

const okOutcome: TranscriptionOutcome = {
  status: 'ok',
  transcript: { text: 'Three rounds.', utterances: [], confidence: 0.95 },
};

function upload(file: Blob | null, headers: Record<string, string> = {}) {
  const form = new FormData();
  if (file) form.append('file', file, 'clip.mp4');
  return new Request('https://example.invalid/api/transcribe', {
    method: 'POST',
    headers,
    body: form,
  });
}

function videoBlob(bytes = 2048, type = 'video/mp4') {
  return new Blob([new Uint8Array(bytes)], { type });
}

describe('POST /api/transcribe', () => {
  it('transcribes an uploaded video', async () => {
    const { service, transcribe } = stubService(okOutcome);
    const response = await handleTranscribeRequest(upload(videoBlob()), service);

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ status: 'ok' });
    expect(transcribe.mock.calls[0]?.[0].mediaType).toBe('video/mp4');
    expect(transcribe.mock.calls[0]?.[0].bytes.byteLength).toBe(2048);
  });

  it('returns "no speech" as a normal 200 result', async () => {
    // A silent demonstration is a real video, not a transport failure.
    const { service } = stubService({ status: 'no_speech' });
    const response = await handleTranscribeRequest(upload(videoBlob()), service);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: 'no_speech' });
  });

  it('reports a missing provider without failing the import', async () => {
    const response = await handleTranscribeRequest(upload(videoBlob()), null);
    expect(response.status).toBe(503);
    // Non-retryable: the client treats this as "no transcript" and uses frames.
    expect(await response.json()).toMatchObject({ retryable: false });
  });

  it('rejects a request with no file', async () => {
    const { service, transcribe } = stubService(okOutcome);
    expect((await handleTranscribeRequest(upload(null), service)).status).toBe(400);
    expect(transcribe).not.toHaveBeenCalled();
  });

  it('rejects an empty file', async () => {
    const { service, transcribe } = stubService(okOutcome);
    const response = await handleTranscribeRequest(upload(videoBlob(0)), service);
    expect(response.status).toBe(400);
    expect(transcribe).not.toHaveBeenCalled();
  });

  it('rejects an oversized upload by declared length before reading it', async () => {
    const { service, transcribe } = stubService(okOutcome);
    const response = await handleTranscribeRequest(
      upload(videoBlob(), { 'content-length': String(500 * 1024 * 1024) }),
      service,
    );

    expect(response.status).toBe(413);
    expect(transcribe).not.toHaveBeenCalled();
  });

  it('rejects a file type it cannot transcribe', async () => {
    const { service, transcribe } = stubService(okOutcome);
    const response = await handleTranscribeRequest(
      upload(videoBlob(1024, 'application/pdf')),
      service,
    );

    expect(response.status).toBe(415);
    expect(transcribe).not.toHaveBeenCalled();
  });

  it('tolerates a codec parameter on the media type', async () => {
    // Some clients send `video/mp4; codecs=avc1`.
    const { service, transcribe } = stubService(okOutcome);
    const response = await handleTranscribeRequest(
      upload(videoBlob(1024, 'video/mp4; codecs=avc1.42E01E')),
      service,
    );

    expect(response.status).toBe(200);
    expect(transcribe.mock.calls[0]?.[0].mediaType).toBe('video/mp4');
  });

  it('assumes mp4 when the client sends no media type at all', async () => {
    // React Native sometimes omits it; a picked video is virtually always mp4.
    const { service, transcribe } = stubService(okOutcome);
    const response = await handleTranscribeRequest(upload(videoBlob(1024, '')), service);

    expect(response.status).toBe(200);
    expect(transcribe.mock.calls[0]?.[0].mediaType).toBe('video/mp4');
  });
});
