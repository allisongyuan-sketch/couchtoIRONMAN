import { asyncStorageKeyValueStore } from '@/data/asyncStorage';
import { createRepositories } from '@/data/repositories';
import { MockExtractionService } from '@/core/extraction/mockService';
import { MockMediaProcessor } from '@/core/extraction/mediaProcessor';
import { RemoteExtractionService } from '@/core/extraction/remoteExtractionService';
import { VideoFrameMediaProcessor } from '@/core/extraction/videoFrameProcessor';
import type { ImportDependencies } from '@/core/import/importWorkout';

/**
 * Composition root.
 *
 * The one place that decides which concrete adapters the app runs with. Everything
 * else depends on interfaces, which is why switching from the mock to real
 * extraction is this file and nothing else — no screen, store, or test changes.
 */

export const repositories = createRepositories(asyncStorageKeyValueStore);

/**
 * The extraction endpoint, if one is configured.
 *
 * Note what this is NOT: an API key. Credentials never reach the device — this is a
 * URL pointing at our own server (`app/api/extract+api.ts` is the reference
 * implementation), which holds the key. `EXPO_PUBLIC_` variables are inlined into
 * the app bundle and readable by anyone with the binary, so a URL is the only kind
 * of thing that may live here.
 */
const extractionEndpoint = process.env.EXPO_PUBLIC_EXTRACTION_ENDPOINT?.trim();

export const usingRealExtraction = !!extractionEndpoint;

/**
 * Two coherent configurations, not a pile of flags.
 *
 * **Real**: frames are sampled from a video the user supplied and sent to Claude.
 * Content we cannot download is refused honestly — `analyzeMetadataOnlyContent` is
 * false, so a TikTok link we can't fetch lands on "We couldn't access enough of this
 * video" with upload and manual fallbacks, rather than being sent to a model with
 * nothing to look at.
 *
 * **Mock**: schema-valid fixtures with realistic latency, so the whole flow is
 * demoable and testable with no credentials and no server.
 */
export const importDependencies: ImportDependencies = extractionEndpoint
  ? {
      mediaProcessor: new VideoFrameMediaProcessor(),
      extractionService: new RemoteExtractionService({ endpoint: extractionEndpoint }),
      policy: { analyzeMetadataOnlyContent: false },
    }
  : {
      mediaProcessor: new MockMediaProcessor(),
      extractionService: new MockExtractionService({ latencyMs: 2200 }),
      policy: { analyzeMetadataOnlyContent: true },
    };
