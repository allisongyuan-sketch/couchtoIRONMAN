import type { Platform, WorkoutSource } from '../schema/workout';
import type { ContentIngestionProvider, IngestionInput, IngestionResult } from './types';
import { parseSourceUrl, platformLabel } from './urls';

/**
 * Social platform providers.
 *
 * Each one recognises its URLs and recovers attribution. None of them claim to
 * download media, because in the general case that is not something the product can
 * promise (PRD §19). They resolve to `metadata_only`, which the import flow treats as
 * a legitimate outcome with an upload/manual fallback — not as a failure.
 *
 * Adding real media access later (an official API, an oEmbed integration, a
 * server-side resolver) means changing ONE provider. No screen changes, no schema
 * changes, no changes to the extraction pipeline.
 */
function socialProvider(
  platform: Exclude<Platform, 'upload' | 'other'>,
  reason: string,
): ContentIngestionProvider {
  return {
    id: `${platform}-url`,
    platform,
    canHandle(url: string) {
      return parseSourceUrl(url)?.platform === platform;
    },
    async ingest(input: IngestionInput): Promise<IngestionResult> {
      if (!input.url) return { status: 'failed', reason: 'No URL provided', retryable: false };
      const parsed = parseSourceUrl(input.url);
      if (!parsed || parsed.platform !== platform) {
        return { status: 'unsupported_source', url: input.url };
      }

      const source: WorkoutSource = { platform, url: parsed.normalizedUrl };
      if (parsed.creatorHandle) source.creatorHandle = parsed.creatorHandle;
      source.sourceTitle = `${platformLabel(platform)} video`;

      return { status: 'metadata_only', source, reason };
    },
  };
}

export const tiktokProvider = socialProvider(
  'tiktok',
  'TikTok does not expose this video for download.',
);

export const instagramProvider = socialProvider(
  'instagram',
  'Instagram does not expose this reel for download.',
);

export const youtubeProvider = socialProvider(
  'youtube',
  'This YouTube video is not available for direct analysis.',
);

/** The fallback that always works: the user hands us the file themselves. */
export const uploadProvider: ContentIngestionProvider = {
  id: 'upload',
  platform: 'upload',
  canHandle() {
    return false; // Never selected by URL — chosen explicitly by the user.
  },
  async ingest(input: IngestionInput): Promise<IngestionResult> {
    if (!input.localFileUri) {
      return { status: 'failed', reason: 'No file was provided', retryable: false };
    }
    return {
      status: 'ok',
      source: { platform: 'upload', sourceTitle: 'Uploaded video' },
      media: {
        mediaUri: input.localFileUri,
        ...(input.durationSeconds !== undefined
          ? { durationSeconds: input.durationSeconds }
          : {}),
      },
    };
  },
};

export const DEFAULT_PROVIDERS: ContentIngestionProvider[] = [
  tiktokProvider,
  instagramProvider,
  youtubeProvider,
  uploadProvider,
];
