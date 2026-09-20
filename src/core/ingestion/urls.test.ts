import { describe, expect, it } from 'vitest';
import { isSupportedSourceUrl, parseSourceUrl } from './urls';

describe('parseSourceUrl', () => {
  it('recovers platform, creator and content id from a TikTok link', () => {
    const parsed = parseSourceUrl('https://www.tiktok.com/@coachlena/video/7311122334455?is_from=1');
    expect(parsed).toMatchObject({
      platform: 'tiktok',
      creatorHandle: '@coachlena',
      contentId: '7311122334455',
      // Tracking parameters are dropped: attribution should not carry a session token.
      normalizedUrl: 'https://www.tiktok.com/@coachlena/video/7311122334455',
    });
  });

  it('handles Instagram reels with and without a creator segment', () => {
    expect(parseSourceUrl('https://www.instagram.com/reel/Cx1y2z3/')).toMatchObject({
      platform: 'instagram',
      contentId: 'Cx1y2z3',
    });
    expect(parseSourceUrl('https://www.instagram.com/mobilitycoach/reel/Cx1y2z3/')).toMatchObject({
      platform: 'instagram',
      creatorHandle: '@mobilitycoach',
      contentId: 'Cx1y2z3',
    });
  });

  it('handles the three YouTube link shapes', () => {
    expect(parseSourceUrl('https://www.youtube.com/shorts/abc123')?.contentId).toBe('abc123');
    expect(parseSourceUrl('https://youtu.be/abc123')?.contentId).toBe('abc123');
    expect(parseSourceUrl('https://www.youtube.com/watch?v=abc123')?.contentId).toBe('abc123');
  });

  it('accepts a link pasted without a scheme', () => {
    expect(parseSourceUrl('tiktok.com/@a/video/1')?.platform).toBe('tiktok');
  });

  it('rejects anything it does not recognise, rather than guessing', () => {
    expect(parseSourceUrl('https://example.com/workout')).toBeNull();
    expect(parseSourceUrl('not a url')).toBeNull();
    expect(parseSourceUrl('')).toBeNull();
    expect(isSupportedSourceUrl('https://vimeo.com/123')).toBe(false);
  });
});
