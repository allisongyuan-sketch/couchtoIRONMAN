/**
 * Speech transcription (PRD §10, source priority #1).
 *
 * Spoken audio is the *highest* priority extraction source in the PRD, and until now
 * it was the one we could not read: Claude has no audio input, so a creator who only
 * says "three rounds of ten" produced a workout with movements and no numbers.
 *
 * This is the port that closes that gap. It is deliberately separate from
 * `WorkoutExtractionService`: transcription is a different vendor, a different
 * payload (media bytes, not JSON), and a different failure mode. Most importantly it
 * is *optional* — a failed transcription degrades the import to frames-only rather
 * than failing it.
 */

export interface TranscriptWord {
  text: string;
  startSeconds: number;
  endSeconds: number;
  /** 0–1. This is what makes "12 or 20 reps?" detectable (PRD §9). */
  confidence: number;
}

export interface TranscriptUtterance {
  text: string;
  startSeconds: number;
  endSeconds: number;
  confidence: number;
  words: TranscriptWord[];
}

export interface Transcript {
  /** The whole transcript as one string, for logging and debugging. */
  text: string;
  utterances: TranscriptUtterance[];
  /** Mean confidence across the transcript. */
  confidence: number;
  language?: string;
}

export type TranscriptionOutcome =
  | { status: 'ok'; transcript: Transcript }
  /** The audio carried no speech. A silent demo is a normal, expected case. */
  | { status: 'no_speech' }
  | { status: 'failed'; reason: string; retryable: boolean };

export interface TranscriptionOptions {
  signal?: AbortSignal;
}

/**
 * The seam. One implementation today (Deepgram); adding another means writing one
 * class and changing one line in the server factory.
 */
export interface TranscriptionService {
  readonly id: string;
  transcribe(
    media: { bytes: ArrayBuffer; mediaType: string },
    options?: TranscriptionOptions,
  ): Promise<TranscriptionOutcome>;
}

/** The device-side counterpart: hands a local file to our endpoint. */
export interface TranscriptionClient {
  readonly id: string;
  transcribeFile(
    file: { uri: string; mediaType: string },
    options?: TranscriptionOptions,
  ): Promise<TranscriptionOutcome>;
}
