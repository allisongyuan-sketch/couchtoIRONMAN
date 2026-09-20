import { createId } from '../util/id';
import type { Extraction } from '../schema/extraction';
import type { Exercise, Workout, WorkoutSource } from '../schema/workout';
import { structuredWorkoutExtractionSchema } from '../schema/extraction';
import { applyGuardrails } from './guardrails';
import { normalizeExtraction } from './normalize';
import type {
  ExtractionOptions,
  ProcessedMedia,
  WorkoutExtractionService,
} from './service';

/**
 * The extraction pipeline (PRD §20), assembled from independently replaceable stages:
 *
 *   ProcessedMedia
 *     → WorkoutExtractionService   (the only stage that knows a model exists)
 *     → schema validation          (reject malformed output before it reaches state)
 *     → guardrail pass             (delete prescriptions the source never supported)
 *     → normalization              (assign ids, link the Exercise catalog)
 *     → Workout + Extraction record
 *
 * The Extraction record is retained alongside the Workout so that user edits never
 * destroy the original, and so extraction edit rate stays measurable (PRD §29).
 */

export type PipelineResult =
  | {
      status: 'ok';
      workout: Workout;
      exercises: Exercise[];
      extraction: Extraction;
    }
  | { status: 'no_workout_detected'; detectedMovements: string[]; extraction: Extraction }
  | { status: 'failed'; reason: string; retryable: boolean; extraction: Extraction };

export async function runExtractionPipeline(
  service: WorkoutExtractionService,
  media: ProcessedMedia,
  options: ExtractionOptions & { now?: Date } = {},
): Promise<PipelineResult> {
  const startedAt = Date.now();
  const now = options.now ?? new Date();
  const extractionId = createId('ext');

  const base = {
    id: extractionId,
    sourceContentId: media.sourceContentId,
    serviceId: service.id,
    source: media.source,
    createdAt: now.toISOString(),
  };

  const outcome = await service.extractWorkout(media, options);

  if (outcome.status === 'failed') {
    return {
      status: 'failed',
      reason: outcome.reason,
      retryable: outcome.retryable,
      extraction: {
        ...base,
        status: 'failed',
        result: null,
        guardrailActions: [],
        detectedMovements: [],
        failureReason: outcome.reason,
        durationMs: Date.now() - startedAt,
      },
    };
  }

  if (outcome.status === 'no_workout_detected') {
    return {
      status: 'no_workout_detected',
      detectedMovements: outcome.detectedMovements,
      extraction: {
        ...base,
        status: 'no_workout_detected',
        result: null,
        guardrailActions: [],
        detectedMovements: outcome.detectedMovements,
        durationMs: Date.now() - startedAt,
      },
    };
  }

  // Validate before anything downstream sees it. A vendor that returns nonsense is a
  // failure we report, not a shape we defensively work around all over the app.
  const parsed = structuredWorkoutExtractionSchema.safeParse(outcome.result);
  if (!parsed.success) {
    const reason = 'The extraction did not match the expected structure';
    return {
      status: 'failed',
      reason,
      retryable: true,
      extraction: {
        ...base,
        status: 'failed',
        result: null,
        guardrailActions: [],
        detectedMovements: [],
        failureReason: reason,
        durationMs: Date.now() - startedAt,
      },
    };
  }

  const guarded = applyGuardrails(parsed.data);
  const { workout, exercises } = normalizeExtraction(guarded.result, media.source, {
    extractionId,
    now,
  });

  return {
    status: 'ok',
    workout,
    exercises,
    extraction: {
      ...base,
      status: 'succeeded',
      result: guarded.result,
      guardrailActions: guarded.actions,
      detectedMovements: guarded.result.detectedMovements,
      durationMs: Date.now() - startedAt,
    },
  };
}

export function sourceFromIngestion(source: WorkoutSource): WorkoutSource {
  return { ...source };
}
