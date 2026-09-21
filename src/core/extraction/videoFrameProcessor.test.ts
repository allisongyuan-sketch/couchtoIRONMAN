import { beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  TranscriptionClient,
  TranscriptionOutcome,
} from '../transcription/types';

/**
 * The native modules are mocked so the sampling logic — which is where the bugs
 * would be — can be tested in Node without a device.
 */
const getThumbnailAsync = vi.fn();
const manipulateAsync = vi.fn();

vi.mock('expo-video-thumbnails', () => ({ getThumbnailAsync }));
vi.mock('expo-image-manipulator', () => ({
  manipulateAsync,
  SaveFormat: { JPEG: 'jpeg', PNG: 'png' },
}));

const { VideoFrameMediaProcessor } = await import('./videoFrameProcessor');

/** A transcription client that returns whatever the test wants. */
function stubTranscription(outcome: TranscriptionOutcome | Error) {
  const transcribeFile = vi.fn(async () => {
    if (outcome instanceof Error) throw outcome;
    return outcome;
  });
  return { transcribeFile, client: { id: 'stub', transcribeFile } as TranscriptionClient };
}

function spokenTranscript(): TranscriptionOutcome {
  return {
    status: 'ok',
    transcript: {
      text: 'Three rounds. Twelve reps each side.',
      confidence: 0.9,
      utterances: [
        {
          text: 'Three rounds.',
          startSeconds: 0,
          endSeconds: 1.5,
          confidence: 0.96,
          words: [
            { text: '3', startSeconds: 0, endSeconds: 0.4, confidence: 0.97 },
            { text: 'rounds.', startSeconds: 0.5, endSeconds: 1.5, confidence: 0.95 },
          ],
        },
        {
          text: 'Twelve reps each side.',
          startSeconds: 2,
          endSeconds: 4,
          confidence: 0.9,
          words: [
            { text: '12', startSeconds: 2, endSeconds: 2.5, confidence: 0.6 },
            { text: 'reps', startSeconds: 2.6, endSeconds: 3, confidence: 0.99 },
            { text: 'each', startSeconds: 3.1, endSeconds: 3.4, confidence: 0.98 },
            { text: 'side.', startSeconds: 3.5, endSeconds: 4, confidence: 0.99 },
          ],
        },
      ],
    },
  };
}

const uploadedVideo = {
  status: 'ok',
  source: { platform: 'upload' },
  media: { mediaUri: 'file:///leg-day.mp4', durationSeconds: 30 },
} as const;

beforeEach(() => {
  getThumbnailAsync.mockReset();
  manipulateAsync.mockReset();
  getThumbnailAsync.mockResolvedValue({ uri: 'file:///thumb.jpg', width: 1080, height: 1920 });
  manipulateAsync.mockResolvedValue({ uri: 'file:///small.jpg', base64: 'ZZZZ', width: 768, height: 1365 });
});

describe('VideoFrameMediaProcessor', () => {
  it('samples frames across a video of known duration', async () => {
    const processor = new VideoFrameMediaProcessor({ maxFrames: 4 });
    const media = await processor.process('src_1', {
      status: 'ok',
      source: { platform: 'upload' },
      media: { mediaUri: 'file:///leg-day.mp4', durationSeconds: 30 },
    });

    expect(media.frames).toHaveLength(4);
    expect(media.mediaAnalyzed).toBe(true);
    expect(media.frames.every((frame) => frame.base64 === 'ZZZZ')).toBe(true);
    // Chronological, and spread across the clip rather than bunched at the start.
    const times = media.frames.map((frame) => frame.atSeconds);
    expect([...times].sort((a, b) => a - b)).toEqual(times);
    expect(times[times.length - 1]! - times[0]!).toBeGreaterThan(20);
  });

  it('downscales frames rather than shipping full-resolution stills', async () => {
    const processor = new VideoFrameMediaProcessor({ maxFrames: 1, maxWidth: 512, compress: 0.5 });
    await processor.process('src_1', {
      status: 'ok',
      source: { platform: 'upload' },
      media: { mediaUri: 'file:///clip.mp4', durationSeconds: 10 },
    });

    const [, actions, options] = manipulateAsync.mock.calls[0]!;
    expect(actions).toEqual([{ resize: { width: 512 } }]);
    expect(options).toMatchObject({ base64: true, compress: 0.5 });
  });

  it('probes and stops cleanly when the duration is unknown', async () => {
    // An uploaded file does not always report its length, so we walk a ladder and
    // stop at the first timestamp past the end.
    getThumbnailAsync
      .mockResolvedValueOnce({ uri: 'file:///a.jpg', width: 1, height: 1 })
      .mockResolvedValueOnce({ uri: 'file:///b.jpg', width: 1, height: 1 })
      .mockRejectedValueOnce(new Error('time past end of video'));

    const processor = new VideoFrameMediaProcessor({ maxFrames: 8 });
    const media = await processor.process('src_1', {
      status: 'ok',
      source: { platform: 'upload' },
      media: { mediaUri: 'file:///short.mp4' },
    });

    expect(media.frames).toHaveLength(2);
    expect(media.mediaAnalyzed).toBe(true);
  });

  it('keeps the caption and takes no frames for metadata-only content', async () => {
    const processor = new VideoFrameMediaProcessor();
    const media = await processor.process('src_1', {
      status: 'metadata_only',
      source: { platform: 'tiktok', creatorHandle: '@coach', caption: '3 rounds, 10 each side' },
      reason: 'TikTok does not expose this video for download.',
    });

    expect(media.frames).toHaveLength(0);
    expect(media.mediaAnalyzed).toBe(false);
    // The caption is often the richest text a creator gives us — keep it.
    expect(media.captionText).toBe('3 rounds, 10 each side');
    expect(media.source.creatorHandle).toBe('@coach');
    expect(getThumbnailAsync).not.toHaveBeenCalled();
  });

  it('reports nothing analyzed when a frame yields no data', async () => {
    manipulateAsync.mockResolvedValue({ uri: 'file:///x.jpg', width: 1, height: 1 });
    const processor = new VideoFrameMediaProcessor({ maxFrames: 2 });
    const media = await processor.process('src_1', {
      status: 'ok',
      source: { platform: 'upload' },
      media: { mediaUri: 'file:///clip.mp4', durationSeconds: 10 },
    });

    expect(media.frames).toHaveLength(0);
    expect(media.mediaAnalyzed).toBe(false);
  });
});

describe('VideoFrameMediaProcessor with transcription', () => {
  it('captures spoken prescriptions alongside frames', async () => {
    // The whole point: a creator who only *says* "three rounds of twelve" now
    // produces a transcript the extraction model can read.
    const { client } = stubTranscription(spokenTranscript());
    const processor = new VideoFrameMediaProcessor({ transcription: client, maxFrames: 2 });

    const media = await processor.process('src_1', uploadedVideo);

    expect(media.frames).toHaveLength(2);
    expect(media.transcript).toHaveLength(2);
    expect(media.transcript[0]?.text).toBe('Three rounds.');
    expect(media.transcript[0]?.confidence).toBeCloseTo(0.96);
  });

  it('flags the one number the transcriber was unsure of', async () => {
    // PRD §9 end to end: "12" at 0.6 inside a sentence averaging 0.9.
    const { client } = stubTranscription(spokenTranscript());
    const processor = new VideoFrameMediaProcessor({ transcription: client, maxFrames: 1 });

    const media = await processor.process('src_1', uploadedVideo);

    expect(media.uncertainQuantities).toHaveLength(1);
    expect(media.uncertainQuantities[0]?.text).toBe('12');
    expect(media.uncertainQuantities[0]?.context).toContain('reps');
  });

  it('runs frames and transcription concurrently', async () => {
    // Sequential would make the user wait for the sum of two network-bound stages.
    let transcriptionStarted = false;
    let framesStartedAfterTranscription = false;

    const client: TranscriptionClient = {
      id: 'stub',
      transcribeFile: async () => {
        transcriptionStarted = true;
        await new Promise((resolve) => setTimeout(resolve, 5));
        return spokenTranscript();
      },
    };

    getThumbnailAsync.mockImplementation(async () => {
      if (transcriptionStarted) framesStartedAfterTranscription = true;
      return { uri: 'file:///thumb.jpg', width: 1, height: 1 };
    });

    const processor = new VideoFrameMediaProcessor({ transcription: client, maxFrames: 2 });
    await processor.process('src_1', uploadedVideo);

    expect(framesStartedAfterTranscription).toBe(true);
  });

  it('degrades to frames when the transcriber fails', async () => {
    // A transcription outage must cost evidence, not the whole import.
    const { client } = stubTranscription({ status: 'failed', reason: 'down', retryable: true });
    const processor = new VideoFrameMediaProcessor({ transcription: client, maxFrames: 2 });

    const media = await processor.process('src_1', uploadedVideo);

    expect(media.transcript).toEqual([]);
    expect(media.frames).toHaveLength(2);
    expect(media.mediaAnalyzed).toBe(true);
  });

  it('degrades to frames when the transcriber throws', async () => {
    const { client } = stubTranscription(new Error('socket hang up'));
    const processor = new VideoFrameMediaProcessor({ transcription: client, maxFrames: 2 });

    const media = await processor.process('src_1', uploadedVideo);

    expect(media.transcript).toEqual([]);
    expect(media.frames).toHaveLength(2);
  });

  it('treats a silent video as normal', async () => {
    const { client } = stubTranscription({ status: 'no_speech' });
    const processor = new VideoFrameMediaProcessor({ transcription: client, maxFrames: 2 });

    const media = await processor.process('src_1', uploadedVideo);

    expect(media.transcript).toEqual([]);
    expect(media.uncertainQuantities).toEqual([]);
    expect(media.mediaAnalyzed).toBe(true);
  });

  it('does not attempt transcription for metadata-only content', async () => {
    // There is no file to send.
    const { client, transcribeFile } = stubTranscription(spokenTranscript());
    const processor = new VideoFrameMediaProcessor({ transcription: client });

    await processor.process('src_1', {
      status: 'metadata_only',
      source: { platform: 'tiktok', caption: 'leg day' },
      reason: 'TikTok does not expose this video for download.',
    });

    expect(transcribeFile).not.toHaveBeenCalled();
  });

  it('counts a transcript alone as analyzable when no frame could be taken', async () => {
    getThumbnailAsync.mockRejectedValue(new Error('no video track'));
    const { client } = stubTranscription(spokenTranscript());
    const processor = new VideoFrameMediaProcessor({ transcription: client });

    const media = await processor.process('src_1', uploadedVideo);

    expect(media.frames).toEqual([]);
    expect(media.transcript).toHaveLength(2);
    expect(media.mediaAnalyzed).toBe(true);
  });
});
