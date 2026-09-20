import { describe, expect, it } from 'vitest';
import { extractFirstUrl, findShareUrl, resolveSharedContent } from './shareIntent';

/**
 * The share payloads that actually arrive. Every case here is a real shape from one
 * platform or another — the point of keeping this resolver pure is that they are
 * tests rather than things to find out on a device.
 */
describe('resolveSharedContent', () => {
  it('takes a clean weburl share (iOS)', () => {
    const result = resolveSharedContent({
      type: 'weburl',
      webUrl: 'https://www.tiktok.com/@coachlena/video/7311122334455',
    });

    expect(result).toEqual({
      status: 'ok',
      entryPoint: 'share_sheet',
      input: { url: 'https://www.tiktok.com/@coachlena/video/7311122334455' },
    });
  });

  it('digs the link out of shared text (Android)', () => {
    // TikTok on Android shares a sentence, not a URL field.
    const result = resolveSharedContent({
      type: 'text',
      text: 'Check out this workout on TikTok https://vm.tiktok.com/ZGeabc123/ 🔥',
    });

    expect(result.status).toBe('ok');
    if (result.status !== 'ok') return;
    expect(result.input.url).toBe('https://vm.tiktok.com/ZGeabc123/');
  });

  it('handles a short link, which carries no creator or id', () => {
    // vm.tiktok.com still resolves to the right platform for attribution, even
    // though the path tells us nothing.
    const result = resolveSharedContent({ type: 'text', text: 'https://vm.tiktok.com/ZGeabc/' });
    expect(result.status).toBe('ok');
  });

  it('prefers a shared VIDEO FILE over a shared link', () => {
    // This is the case that beats the platform-download problem outright: the share
    // sheet hands us media we could never have fetched ourselves.
    const result = resolveSharedContent({
      type: 'media',
      webUrl: 'https://www.instagram.com/reel/Cx1y2z3/',
      files: [{ path: 'file:///tmp/reel.mp4', mimeType: 'video/mp4', duration: 42 }],
    });

    expect(result.status).toBe('ok');
    if (result.status !== 'ok') return;
    expect(result.input.localFileUri).toBe('file:///tmp/reel.mp4');
    expect(result.input.durationSeconds).toBe(42);
    expect(result.input.url).toBeUndefined();
  });

  it('converts a millisecond duration', () => {
    // Some platforms report ms. 42000 seconds is not a short-form video.
    const result = resolveSharedContent({
      type: 'media',
      files: [{ path: 'file:///tmp/reel.mp4', mimeType: 'video/mp4', duration: 42000 }],
    });

    expect(result.status).toBe('ok');
    if (result.status !== 'ok') return;
    expect(result.input.durationSeconds).toBe(42);
  });

  it('ignores a shared image and falls back to the link', () => {
    const result = resolveSharedContent({
      type: 'media',
      webUrl: 'https://www.youtube.com/shorts/abc123',
      files: [{ path: 'file:///tmp/thumb.jpg', mimeType: 'image/jpeg' }],
    });

    expect(result.status).toBe('ok');
    if (result.status !== 'ok') return;
    expect(result.input.url).toContain('youtube.com');
    expect(result.input.localFileUri).toBeUndefined();
  });

  it('reports an unsupported link rather than trying it', () => {
    const result = resolveSharedContent({ type: 'weburl', webUrl: 'https://vimeo.com/123' });
    expect(result).toEqual({ status: 'unsupported_url', url: 'https://vimeo.com/123' });
  });

  it('reports a payload with nothing usable in it', () => {
    expect(resolveSharedContent({ type: 'text', text: 'nice workout!' })).toEqual({
      status: 'nothing_usable',
    });
    expect(resolveSharedContent({ type: null })).toEqual({ status: 'nothing_usable' });
    expect(resolveSharedContent({ type: 'media', files: [] })).toEqual({
      status: 'nothing_usable',
    });
  });
});

describe('extractFirstUrl', () => {
  it('picks the supported link when the text carries several', () => {
    // Share text routinely includes a tracking link and a profile link too.
    const text =
      'via https://bit.ly/xyz — watch https://www.tiktok.com/@a/video/123 and follow https://example.com/me';
    expect(extractFirstUrl(text)).toBe('https://www.tiktok.com/@a/video/123');
  });

  it('falls back to the first link when none are supported', () => {
    expect(extractFirstUrl('see https://example.com/a and https://example.com/b')).toBe(
      'https://example.com/a',
    );
  });

  it('strips sentence punctuation that rides along with the URL', () => {
    expect(extractFirstUrl('Try https://www.tiktok.com/@a/video/123.')).toBe(
      'https://www.tiktok.com/@a/video/123',
    );
  });

  it('returns null when there is no link', () => {
    expect(extractFirstUrl('')).toBeNull();
    expect(extractFirstUrl('no links here')).toBeNull();
  });
});

describe('findShareUrl', () => {
  it('prefers the explicit field over text', () => {
    expect(
      findShareUrl({
        type: 'weburl',
        webUrl: 'https://www.tiktok.com/@a/video/1',
        text: 'https://example.com/other',
      }),
    ).toBe('https://www.tiktok.com/@a/video/1');
  });
});
