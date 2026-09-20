import type {
  ExtractionOptions,
  ExtractionOutcome,
  ProcessedMedia,
  WorkoutExtractionService,
} from './service';
import { hasAnalyzableEvidence } from './prompt';

/**
 * The extraction service the app actually runs in production.
 *
 * It implements the same `WorkoutExtractionService` interface as the mock, so
 * switching between them is one line in the composition root and no screen, store or
 * test outside this file knows the difference.
 *
 * It contains no prompt, no model name and no credential. All of that lives behind
 * the endpoint (`app/api/extract+api.ts`), because an API key in a mobile bundle is
 * extractable by anyone who downloads the app.
 */

export interface RemoteExtractionConfig {
  /** Absolute URL of the extraction endpoint. */
  endpoint: string;
  /**
   * How long to wait before giving up. Extraction with frames and adaptive thinking
   * is not fast, and the processing screen is honest about that — but a request that
   * hangs forever leaves the user staring at "Creating your workout…" with no way out.
   */
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

const DEFAULT_TIMEOUT_MS = 120_000;

export class RemoteExtractionService implements WorkoutExtractionService {
  readonly id = 'remote';

  constructor(private readonly config: RemoteExtractionConfig) {}

  async extractWorkout(
    media: ProcessedMedia,
    options?: ExtractionOptions,
  ): Promise<ExtractionOutcome> {
    if (!hasAnalyzableEvidence(media)) {
      // Fail here rather than paying for a round trip that cannot succeed.
      return {
        status: 'failed',
        reason: 'There was not enough of this video to analyze',
        retryable: false,
      };
    }

    const doFetch = this.config.fetchImpl ?? fetch;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.config.timeoutMs ?? DEFAULT_TIMEOUT_MS);

    // Honour a caller's cancellation (the user leaving the processing screen) as
    // well as our own timeout.
    const abortFromCaller = () => controller.abort();
    options?.signal?.addEventListener('abort', abortFromCaller);

    try {
      const response = await doFetch(this.config.endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(toRequestBody(media)),
        signal: controller.signal,
      });

      if (!response.ok) {
        return {
          status: 'failed',
          reason:
            response.status === 413
              ? 'That video is too large to analyze'
              : 'The analyzer could not process this video',
          retryable: response.status >= 500 || response.status === 429,
        };
      }

      const outcome: unknown = await response.json();
      return isExtractionOutcome(outcome)
        ? outcome
        : {
            status: 'failed',
            reason: 'The analyzer returned data in an unexpected shape',
            retryable: true,
          };
    } catch (error) {
      if (options?.signal?.aborted) {
        return { status: 'failed', reason: 'Extraction was cancelled', retryable: true };
      }
      if (isAbortError(error)) {
        return { status: 'failed', reason: 'The analyzer took too long to respond', retryable: true };
      }
      return { status: 'failed', reason: 'Could not reach the analyzer', retryable: true };
    } finally {
      clearTimeout(timeout);
      options?.signal?.removeEventListener('abort', abortFromCaller);
    }
  }
}

/**
 * Only what the endpoint needs. `visualObservations` is deliberately omitted: it is
 * the output of a vision stage we do not run client-side, and sending an empty array
 * would just be noise in the request.
 */
function toRequestBody(media: ProcessedMedia): Record<string, unknown> {
  return {
    sourceContentId: media.sourceContentId,
    source: media.source,
    mediaAnalyzed: media.mediaAnalyzed,
    transcript: media.transcript,
    onScreenText: media.onScreenText,
    ...(media.captionText ? { captionText: media.captionText } : {}),
    frames: media.frames,
    uncertainQuantities: media.uncertainQuantities,
    ...(media.durationSeconds !== undefined ? { durationSeconds: media.durationSeconds } : {}),
  };
}

/**
 * The response crosses a network boundary, so it is untrusted until checked. The
 * pipeline validates the extraction itself against the schema; this only confirms
 * the envelope is one of the three shapes the caller knows how to branch on.
 */
function isExtractionOutcome(value: unknown): value is ExtractionOutcome {
  if (!value || typeof value !== 'object') return false;
  const status = (value as { status?: unknown }).status;
  return status === 'ok' || status === 'no_workout_detected' || status === 'failed';
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError';
}
