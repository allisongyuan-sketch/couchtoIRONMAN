import { createId } from '../util/id';
import { ingestionRegistry, type IngestionRegistry } from '../ingestion/registry';
import type { IngestionInput } from '../ingestion/types';
import { MockMediaProcessor } from '../extraction/mediaProcessor';
import { MockExtractionService } from '../extraction/mockService';
import { runExtractionPipeline } from '../extraction/pipeline';
import type { MediaProcessor, WorkoutExtractionService } from '../extraction/service';
import type { Extraction } from '../schema/extraction';
import type { Exercise, Workout, WorkoutSource } from '../schema/workout';

/**
 * The import orchestrator: the one place that composes ingestion → media processing →
 * extraction, and the one place that decides what a degraded ingestion means.
 *
 * Screens call this. They do not know which provider ran, which model answered, or
 * why media was unavailable — they only render the outcome.
 */

export type ImportFailureKind =
  /** PRD §31: "We don't support this source yet." */
  | 'unsupported_url'
  /** PRD §31: media inaccessible → offer upload / manual fallback. */
  | 'media_inaccessible'
  /** PRD §31: fitness content, but no structured workout. */
  | 'no_workout_detected'
  /** PRD §31: processing failure → allow retry without starting over. */
  | 'processing_failed';

export interface ImportFailure {
  kind: ImportFailureKind;
  message: string;
  retryable: boolean;
  /** Attribution we recovered even though analysis failed — worth keeping on screen. */
  source?: WorkoutSource;
  /** Movements we saw but could not structure (PRD §31). */
  detectedMovements?: string[];
}

export type ImportOutcome =
  | { status: 'ok'; workout: Workout; exercises: Exercise[]; extraction: Extraction }
  | { status: 'failed'; failure: ImportFailure };

export interface ImportPolicy {
  /**
   * Whether content we could not download should still be sent to extraction.
   *
   * With mocks, `true` lets the full happy path be demonstrated end to end.
   * With a real pipeline this becomes `false`, and metadata-only content correctly
   * lands on "We couldn't access enough of this video" with upload/manual fallbacks.
   * The distinction is a single flag rather than a code path that has to be written
   * later.
   */
  analyzeMetadataOnlyContent: boolean;
}

export const DEFAULT_IMPORT_POLICY: ImportPolicy = { analyzeMetadataOnlyContent: true };

export interface ImportDependencies {
  registry?: IngestionRegistry;
  mediaProcessor?: MediaProcessor;
  extractionService?: WorkoutExtractionService;
  policy?: ImportPolicy;
  now?: Date;
  signal?: AbortSignal;
}

export async function importWorkout(
  input: IngestionInput,
  deps: ImportDependencies = {},
): Promise<ImportOutcome> {
  const registry = deps.registry ?? ingestionRegistry;
  const mediaProcessor = deps.mediaProcessor ?? new MockMediaProcessor();
  const extractionService = deps.extractionService ?? new MockExtractionService();
  const policy = deps.policy ?? DEFAULT_IMPORT_POLICY;

  const ingestion = await registry.ingest(input);

  if (ingestion.status === 'unsupported_source') {
    return {
      status: 'failed',
      failure: {
        kind: 'unsupported_url',
        message: "We don't support this source yet.",
        retryable: false,
      },
    };
  }

  if (ingestion.status === 'failed') {
    return {
      status: 'failed',
      failure: {
        kind: 'processing_failed',
        message: ingestion.reason,
        retryable: ingestion.retryable,
      },
    };
  }

  if (ingestion.status === 'metadata_only' && !policy.analyzeMetadataOnlyContent) {
    return {
      status: 'failed',
      failure: {
        kind: 'media_inaccessible',
        message: "We couldn't access enough of this video to create the workout automatically.",
        retryable: false,
        source: ingestion.source,
      },
    };
  }

  const sourceContentId = createId('src');
  const media = await mediaProcessor.process(sourceContentId, ingestion);

  const pipelineOptions: Parameters<typeof runExtractionPipeline>[2] = {};
  if (deps.now) pipelineOptions.now = deps.now;
  if (deps.signal) pipelineOptions.signal = deps.signal;

  const result = await runExtractionPipeline(extractionService, media, pipelineOptions);

  if (result.status === 'no_workout_detected') {
    return {
      status: 'failed',
      failure: {
        kind: 'no_workout_detected',
        message: "We found fitness content, but couldn't identify a structured workout.",
        retryable: false,
        source: media.source,
        detectedMovements: result.detectedMovements,
      },
    };
  }

  if (result.status === 'failed') {
    return {
      status: 'failed',
      failure: {
        kind: 'processing_failed',
        message: result.reason,
        retryable: result.retryable,
        source: media.source,
      },
    };
  }

  return {
    status: 'ok',
    workout: result.workout,
    exercises: result.exercises,
    extraction: result.extraction,
  };
}
