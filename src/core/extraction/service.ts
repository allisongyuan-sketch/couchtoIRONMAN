import type { StructuredWorkoutExtraction } from '../schema/extraction';
import type { WorkoutSource } from '../schema/workout';
import type { IngestionResult } from '../ingestion/types';

/**
 * What the extraction stage is given, after ingestion and media processing.
 *
 * Sources are listed in the PRD's priority order (§10): speech first, then on-screen
 * text, then captions, and visual identification LAST — and visual signal is used only
 * to answer "what movement is this?", never to supply a prescription.
 */
export interface TranscriptSegment {
  startSeconds: number;
  endSeconds: number;
  text: string;
  confidence?: number;
}

export interface OnScreenText {
  startSeconds: number;
  endSeconds: number;
  text: string;
  confidence?: number;
}

export interface VisualObservation {
  startSeconds: number;
  endSeconds: number;
  /** A movement the model believes it is looking at. */
  movementLabel: string;
  confidence?: number;
}

export interface ProcessedMedia {
  sourceContentId: string;
  source: WorkoutSource;
  /** False when we only ever had metadata — extraction must degrade accordingly. */
  mediaAnalyzed: boolean;
  transcript: TranscriptSegment[];
  onScreenText: OnScreenText[];
  captionText?: string;
  visualObservations: VisualObservation[];
  durationSeconds?: number;
}

export interface ExtractionOptions {
  /** Stops a slow vendor from holding the "Creating your workout…" screen forever. */
  signal?: AbortSignal;
}

export type ExtractionOutcome =
  | { status: 'ok'; result: StructuredWorkoutExtraction }
  /** Fitness content, but no structured workout. We still show what we saw (PRD §31). */
  | { status: 'no_workout_detected'; detectedMovements: string[] }
  | { status: 'failed'; reason: string; retryable: boolean };

/**
 * The single seam between the product and any AI vendor (PRD §28).
 *
 * Everything outside this interface — screens, stores, the engine, persistence —
 * is written against the interface, never against a model. Swapping vendors, or
 * moving extraction server-side, changes one factory line.
 */
export interface WorkoutExtractionService {
  readonly id: string;
  extractWorkout(
    media: ProcessedMedia,
    options?: ExtractionOptions,
  ): Promise<ExtractionOutcome>;
}

/**
 * Turns an ingestion result into something the extraction stage can consume.
 * Real ASR / OCR / vision live behind this; today it carries through whatever the
 * ingestion stage legitimately obtained.
 */
export interface MediaProcessor {
  readonly id: string;
  process(sourceContentId: string, ingestion: IngestionResult): Promise<ProcessedMedia>;
}

export function emptyProcessedMedia(
  sourceContentId: string,
  source: WorkoutSource,
): ProcessedMedia {
  return {
    sourceContentId,
    source,
    mediaAnalyzed: false,
    transcript: [],
    onScreenText: [],
    visualObservations: [],
  };
}
