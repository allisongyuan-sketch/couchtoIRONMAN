import type { Platform } from '../schema/workout';

/** Pure URL reasoning. No network, so it is cheap, deterministic and fully testable. */

export interface ParsedSourceUrl {
  platform: Platform;
  normalizedUrl: string;
  creatorHandle?: string;
  contentId?: string;
}

const HOST_PLATFORMS: Array<{ pattern: RegExp; platform: Platform }> = [
  { pattern: /(^|\.)tiktok\.com$/i, platform: 'tiktok' },
  { pattern: /(^|\.)instagram\.com$/i, platform: 'instagram' },
  { pattern: /(^|\.)instagr\.am$/i, platform: 'instagram' },
  { pattern: /(^|\.)youtube\.com$/i, platform: 'youtube' },
  { pattern: /(^|\.)youtu\.be$/i, platform: 'youtube' },
];

export function parseSourceUrl(rawUrl: string): ParsedSourceUrl | null {
  const trimmed = rawUrl.trim();
  if (!trimmed) return null;

  let url: URL;
  try {
    url = new URL(trimmed.startsWith('http') ? trimmed : `https://${trimmed}`);
  } catch {
    return null;
  }

  const match = HOST_PLATFORMS.find((entry) => entry.pattern.test(url.hostname));
  if (!match) return null;

  const normalizedUrl = `${url.origin}${url.pathname}`;
  const parsed: ParsedSourceUrl = { platform: match.platform, normalizedUrl };

  const segments = url.pathname.split('/').filter(Boolean);

  if (match.platform === 'tiktok') {
    // https://www.tiktok.com/@creator/video/123456
    const handleSegment = segments.find((segment) => segment.startsWith('@'));
    if (handleSegment) parsed.creatorHandle = handleSegment;
    const videoIndex = segments.indexOf('video');
    const contentId = videoIndex >= 0 ? segments[videoIndex + 1] : undefined;
    if (contentId) parsed.contentId = contentId;
  } else if (match.platform === 'instagram') {
    // https://www.instagram.com/reel/ABC123/
    const kindIndex = segments.findIndex((segment) => ['reel', 'reels', 'p', 'tv'].includes(segment));
    const contentId = kindIndex >= 0 ? segments[kindIndex + 1] : undefined;
    if (contentId) parsed.contentId = contentId;
    // A handle only appears when it precedes the content kind.
    if (kindIndex > 0) {
      const handle = segments[kindIndex - 1];
      if (handle) parsed.creatorHandle = `@${handle}`;
    }
  } else {
    // https://www.youtube.com/shorts/ABC | https://youtu.be/ABC | ?v=ABC
    const shortsIndex = segments.indexOf('shorts');
    const contentId =
      shortsIndex >= 0
        ? segments[shortsIndex + 1]
        : (url.searchParams.get('v') ?? (url.hostname.includes('youtu.be') ? segments[0] : undefined));
    if (contentId) parsed.contentId = contentId;
  }

  return parsed;
}

export function isSupportedSourceUrl(rawUrl: string): boolean {
  return parseSourceUrl(rawUrl) !== null;
}

export function platformLabel(platform: Platform): string {
  switch (platform) {
    case 'tiktok':
      return 'TikTok';
    case 'instagram':
      return 'Instagram';
    case 'youtube':
      return 'YouTube';
    case 'upload':
      return 'Uploaded video';
    default:
      return 'Other';
  }
}
