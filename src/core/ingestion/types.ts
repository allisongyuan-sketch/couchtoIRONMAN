import type { Platform, WorkoutSource } from '../schema/workout';

/**
 * Ingestion abstraction (PRD §19).
 *
 * The governing assumption: **we cannot count on downloading arbitrary TikTok or
 * Instagram media.** Auth walls, rotating CDN tokens, regional blocks and platform
 * terms all apply, and they change without warning.
 *
 * So ingestion does not return "a video". It returns a *capability report*: here is
 * what we know about this content, and here is how much of it we can actually analyze.
 * Degradation is a first-class, expected outcome — not an error path bolted on later.
 */

export interface IngestionInput {
  /** A pasted or shared URL. */
  url?: string;
  /** A local file the user supplied via the upload fallback. */
  localFileUri?: string;
  /** Free text, for the "Enter Workout Manually" escape hatch. */
  rawText?: string;
}

/** What we managed to obtain that a media processor can actually work on. */
export interface IngestedMedia {
  /** A playable/analyzable URI, when one is legitimately obtainable. */
  mediaUri?: string;
  /** Creator-authored caption text, often the richest signal available. */
  captionText?: string;
  durationSeconds?: number;
}

export type IngestionResult =
  | { status: 'ok'; source: WorkoutSource; media: IngestedMedia }
  /**
   * We have attribution but not analyzable media. NOT an error: we can still show the
   * creator, the link and the thumbnail while routing the user to upload or manual
   * entry (PRD §19, §31).
   */
  | { status: 'metadata_only'; source: WorkoutSource; reason: string }
  | { status: 'unsupported_source'; url: string }
  | { status: 'failed'; reason: string; retryable: boolean };

export interface ContentIngestionProvider {
  readonly id: string;
  readonly platform: Platform;
  canHandle(url: string): boolean;
  ingest(input: IngestionInput): Promise<IngestionResult>;
}
