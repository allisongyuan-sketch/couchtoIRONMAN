import { beforeEach, describe, expect, it, vi } from 'vitest';

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
