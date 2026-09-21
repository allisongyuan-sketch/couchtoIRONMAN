import { describe, expect, it, vi } from 'vitest';
import { DeepgramTranscriptionService, parseDeepgramResponse } from './deepgram';
import { findUncertainQuantities } from '@/core/transcription/uncertainQuantities';

/**
 * A recorded-shape Deepgram payload. The service is exercised against this rather
 * than a live call — what is under test is the request we build and how we read the
 * response, which is where the bugs live.
 */
function deepgramPayload() {
  return {
    results: {
      channels: [
        {
          detected_language: 'en',
          alternatives: [{ transcript: 'Three rounds. Twelve reps each side.', confidence: 0.94 }],
        },
      ],
      utterances: [
        {
          start: 0.1,
          end: 1.8,
          transcript: 'Three rounds.',
          confidence: 0.96,
          words: [
            { word: 'three', punctuated_word: '3', start: 0.1, end: 0.5, confidence: 0.97 },
            { word: 'rounds', punctuated_word: 'rounds.', start: 0.6, end: 1.8, confidence: 0.95 },
          ],
        },
        {
          start: 2.0,
          end: 4.2,
          transcript: 'Twelve reps each side.',
          confidence: 0.9,
          words: [
            { word: 'twelve', punctuated_word: '12', start: 2.0, end: 2.5, confidence: 0.62 },
            { word: 'reps', punctuated_word: 'reps', start: 2.6, end: 3.0, confidence: 0.99 },
            { word: 'each', punctuated_word: 'each', start: 3.1, end: 3.5, confidence: 0.98 },
            { word: 'side', punctuated_word: 'side.', start: 3.6, end: 4.2, confidence: 0.99 },
          ],
        },
      ],
    },
  };
}

function serviceReturning(payload: unknown, status = 200) {
  const fetchImpl = vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: async () => payload,
  } as Response);

  return {
    fetchImpl,
    service: new DeepgramTranscriptionService({
      apiKey: 'dg-test',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    }),
  };
}

const mp4 = { bytes: new ArrayBuffer(2048), mediaType: 'video/mp4' };

describe('DeepgramTranscriptionService', () => {
  it('transcribes an mp4 without any audio extraction step', () => {
    // The whole reason this provider was chosen: it demuxes the video itself, so the
    // app never needs ffmpeg or a native audio module.
    expect(mp4.mediaType).toBe('video/mp4');
  });

  it('requests word-level detail and digit formatting', async () => {
    const { service, fetchImpl } = serviceReturning(deepgramPayload());
    await service.transcribe(mp4);

    const [url, init] = fetchImpl.mock.calls[0]!;
    const parsed = new URL(url as string);
    // Utterances carry per-word confidence, which is what PRD §9 needs.
    expect(parsed.searchParams.get('utterances')).toBe('true');
    // smart_format emits "12" rather than "twelve".
    expect(parsed.searchParams.get('smart_format')).toBe('true');
    expect((init as RequestInit).headers).toMatchObject({
      authorization: 'Token dg-test',
      'content-type': 'video/mp4',
    });
  });

  it('returns utterances with per-word confidence', async () => {
    const { service } = serviceReturning(deepgramPayload());
    const outcome = await service.transcribe(mp4);

    expect(outcome.status).toBe('ok');
    if (outcome.status !== 'ok') return;
    expect(outcome.transcript.utterances).toHaveLength(2);
    expect(outcome.transcript.language).toBe('en');
    // Smart-formatted numerals are preferred over the raw word.
    expect(outcome.transcript.utterances[0]?.words[0]?.text).toBe('3');
  });

  it('surfaces the one shaky number inside an otherwise confident sentence', async () => {
    // End to end for PRD §9: "twelve" at 0.62 in a sentence averaging 0.9.
    const { service } = serviceReturning(deepgramPayload());
    const outcome = await service.transcribe(mp4);
    if (outcome.status !== 'ok') throw new Error('expected a transcript');

    const uncertain = findUncertainQuantities(outcome.transcript.utterances);
    expect(uncertain).toHaveLength(1);
    expect(uncertain[0]?.text).toBe('12');
    expect(uncertain[0]?.context).toContain('reps');
  });

  it('treats a silent video as no speech, not as a failure', async () => {
    // A creator who demonstrates without talking is normal; the import continues on
    // frames alone.
    const { service } = serviceReturning({ results: { utterances: [], channels: [] } });
    expect(await service.transcribe(mp4)).toEqual({ status: 'no_speech' });
  });

  it('marks server errors retryable and client errors not', async () => {
    expect(await serviceReturning({}, 503).service.transcribe(mp4)).toMatchObject({ retryable: true });
    expect(await serviceReturning({}, 429).service.transcribe(mp4)).toMatchObject({ retryable: true });
    expect(await serviceReturning({}, 401).service.transcribe(mp4)).toMatchObject({ retryable: false });
  });

  it('rejects an empty file without calling out', async () => {
    const { service, fetchImpl } = serviceReturning(deepgramPayload());
    const outcome = await service.transcribe({ bytes: new ArrayBuffer(0), mediaType: 'video/mp4' });
    expect(outcome).toMatchObject({ status: 'failed', retryable: false });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('surfaces a network failure as retryable', async () => {
    const service = new DeepgramTranscriptionService({
      apiKey: 'dg-test',
      fetchImpl: (() => Promise.reject(new Error('down'))) as unknown as typeof fetch,
    });
    expect(await service.transcribe(mp4)).toMatchObject({ status: 'failed', retryable: true });
  });
});

describe('parseDeepgramResponse', () => {
  it('falls back to the channel alternative when utterances are absent', async () => {
    // Defensive: if utterances ever stop coming back, degrade to a usable transcript
    // rather than to nothing.
    const payload = {
      results: {
        channels: [
          {
            alternatives: [
              {
                transcript: 'Ten squats.',
                confidence: 0.88,
                words: [
                  { word: 'ten', punctuated_word: '10', start: 0, end: 0.4, confidence: 0.7 },
                  { word: 'squats', punctuated_word: 'squats.', start: 0.5, end: 1.0, confidence: 0.99 },
                ],
              },
            ],
          },
        ],
      },
    };

    const transcript = parseDeepgramResponse(payload);
    expect(transcript?.text).toBe('Ten squats.');
    expect(transcript?.utterances).toHaveLength(1);
    // Word detail survives the fallback, so quantity flagging still works.
    expect(findUncertainQuantities(transcript!.utterances)).toHaveLength(1);
  });

  it('returns null for a payload it does not recognise', () => {
    expect(parseDeepgramResponse(null)).toBeNull();
    expect(parseDeepgramResponse({})).toBeNull();
    expect(parseDeepgramResponse({ results: {} })).toBeNull();
  });
});
