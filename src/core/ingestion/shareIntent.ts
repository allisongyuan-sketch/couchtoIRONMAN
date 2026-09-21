import type { IngestionInput } from './types';
import { isSupportedSourceUrl, parseSourceUrl } from './urls';

/**
 * Turning a share-sheet payload into something we can import (PRD §18).
 *
 * "Share → Repurpose" is the product's core promise and the PRD calls it the ideal
 * experience, but what actually arrives is messy and platform-specific. TikTok on
 * Android hands over free text like `Check this out https://vm.tiktok.com/ZGabc/`.
 * iOS may hand over a clean URL, or the video file itself. Some apps send both.
 *
 * This normalises all of it, and it is pure — so every one of those shapes is a test
 * case rather than something to discover on a device.
 */

/** The subset of a share payload this resolver reads, so it stays vendor-agnostic. */
export interface SharedContent {
  type: 'media' | 'file' | 'text' | 'weburl' | null;
  webUrl?: string | null;
  text?: string | null;
  files?: {
    path: string;
    mimeType: string;
    /** Seconds, when the platform reports it. */
    duration?: number | null;
  }[] | null;
}

export type ShareResolution =
  | { status: 'ok'; input: IngestionInput; entryPoint: 'share_sheet' }
  /** Recognised as a link, but not to a platform we read. */
  | { status: 'unsupported_url'; url: string }
  /** Nothing usable in the payload at all. */
  | { status: 'nothing_usable' };

/**
 * A shared VIDEO FILE beats a shared link, every time.
 *
 * This is the one case where the platform hands us media we could never have
 * downloaded ourselves (U1) — so when a share carries both a file and a URL, the
 * file wins and the URL is kept for attribution.
 */
export function resolveSharedContent(shared: SharedContent): ShareResolution {
  const video = firstVideoFile(shared.files);
  const url = findShareUrl(shared);

  if (video) {
    const input: IngestionInput = { localFileUri: video.path };
    if (video.duration != null && video.duration > 0) {
      input.durationSeconds = normalizeDuration(video.duration);
    }
    return { status: 'ok', input, entryPoint: 'share_sheet' };
  }

  if (url) {
    if (!isSupportedSourceUrl(url)) return { status: 'unsupported_url', url };
    return { status: 'ok', input: { url }, entryPoint: 'share_sheet' };
  }

  return { status: 'nothing_usable' };
}

function firstVideoFile(files: SharedContent['files']): NonNullable<SharedContent['files']>[number] | null {
  if (!files?.length) return null;
  return files.find((file) => file.mimeType?.toLowerCase().startsWith('video/')) ?? null;
}

/**
 * Platforms disagree about where the link lives: a dedicated `webUrl` field, or
 * buried in shared text. Check both, preferring the explicit field.
 */
export function findShareUrl(shared: SharedContent): string | null {
  const explicit = shared.webUrl?.trim();
  if (explicit) return explicit;

  const fromText = extractFirstUrl(shared.text ?? '');
  return fromText ?? null;
}

/**
 * Pull the first URL out of free text.
 *
 * Prefers a URL we actually support, because share text often carries several —
 * a tracking link, the creator's profile, and the video itself.
 */
export function extractFirstUrl(text: string): string | null {
  if (!text.trim()) return null;

  const matches = text.match(/https?:\/\/[^\s<>"')\]]+/gi) ?? [];
  const cleaned = matches.map(trimTrailingPunctuation).filter(Boolean);
  if (cleaned.length === 0) return null;

  return cleaned.find((url) => parseSourceUrl(url) !== null) ?? cleaned[0] ?? null;
}

/** Share text usually ends a sentence, and the punctuation rides along with the URL. */
function trimTrailingPunctuation(url: string): string {
  return url.replace(/[.,;:!?]+$/, '');
}

/**
 * Platforms report duration in seconds or milliseconds depending on who is asking.
 * Anything implausibly long for short-form video is milliseconds.
 */
function normalizeDuration(duration: number): number {
  return duration > 1800 ? duration / 1000 : duration;
}
