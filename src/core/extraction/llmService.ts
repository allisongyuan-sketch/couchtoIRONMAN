import { structuredWorkoutExtractionSchema } from '../schema/extraction';
import type {
  ExtractionOptions,
  ExtractionOutcome,
  ProcessedMedia,
  WorkoutExtractionService,
} from './service';

/**
 * The vendor-backed extraction service (PRD §28, Milestone 4).
 *
 * This is the ONLY file in the codebase that knows a language model exists. Nothing
 * imports it directly — the composition root selects it, and every caller depends on
 * `WorkoutExtractionService`. Swapping vendors, or moving extraction server-side,
 * means editing this file and one line in `src/state/container.ts`.
 *
 * It is deliberately shipped unwired. It needs credentials (see the table in
 * docs/ARCHITECTURE.md §9) and, more importantly, it needs a media-processing stage
 * in front of it that can actually produce a transcript — which is blocked on the
 * social-platform ingestion question (U1). Until then the app runs on the mock, and
 * the seam is proven by the fact that swapping them changes nothing else.
 */

export interface LLMExtractionConfig {
  /** Never hardcode. Injected from the composition root, sourced from the server. */
  apiKey: string;
  model: string;
  endpoint: string;
  /** Requests should be made from a backend, not the device — see the note below. */
  fetchImpl?: typeof fetch;
}

/**
 * The extraction contract, stated to the model in the same terms the guardrails
 * enforce. The prompt asks for the right behaviour; `applyGuardrails` guarantees it.
 * Both exist because a prompt is a request and a guardrail is a rule.
 */
export const EXTRACTION_SYSTEM_PROMPT = `You convert short-form fitness video into a structured workout.

You will receive a transcript, on-screen text, captions, and a list of visually
observed movements, each with timestamps.

Return ONLY JSON matching the provided schema. No prose.

Rules you must follow exactly:

1. EXTRACT, DO NOT INVENT. Only record sets, reps, durations, rest, weight or
   rounds that the creator actually stated in speech, on-screen text, or the
   caption. If the creator never said it, omit the field entirely. Never supply a
   typical or reasonable default.
2. You MAY name a movement you can only see being demonstrated. Mark that field
   with source "visual_identification".
3. You may NOT derive any quantity from visual observation. Seeing ten repetitions
   is not the creator prescribing ten repetitions.
4. Form cues must be the creator's own words, with source "speech",
   "onscreen_text" or "caption". Never write your own coaching, modifications, or
   medical advice.
5. Set "confidence" honestly. If the audio was ambiguous between two numbers,
   record your best reading with low confidence rather than guessing confidently.
6. Represent structure. If exercises are performed back-to-back for several rounds,
   emit ONE block with kind "circuit" and the stated number of rounds — not
   several unrelated exercises.`;

export class LLMExtractionService implements WorkoutExtractionService {
  readonly id: string;

  constructor(private readonly config: LLMExtractionConfig) {
    this.id = `llm:${config.model}`;
  }

  async extractWorkout(
    media: ProcessedMedia,
    options?: ExtractionOptions,
  ): Promise<ExtractionOutcome> {
    // Without a transcript or visual observations there is nothing to extract from.
    // Saying so is better than asking a model to hallucinate from a caption alone.
    if (!media.mediaAnalyzed && media.transcript.length === 0 && !media.captionText) {
      return {
        status: 'failed',
        reason: 'There was not enough of this video to analyze',
        retryable: false,
      };
    }

    const doFetch = this.config.fetchImpl ?? fetch;

    let response: Response;
    try {
      response = await doFetch(this.config.endpoint, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${this.config.apiKey}`,
        },
        body: JSON.stringify({
          model: this.config.model,
          system: EXTRACTION_SYSTEM_PROMPT,
          input: buildInput(media),
        }),
        ...(options?.signal ? { signal: options.signal } : {}),
      });
    } catch (error) {
      return {
        status: 'failed',
        reason: error instanceof Error ? error.message : 'The analyzer is unreachable',
        retryable: true,
      };
    }

    if (!response.ok) {
      return {
        status: 'failed',
        reason: `The analyzer returned ${response.status}`,
        // 4xx will fail again identically; 5xx and 429 are worth another attempt.
        retryable: response.status >= 500 || response.status === 429,
      };
    }

    const body: unknown = await response.json();
    const parsed = structuredWorkoutExtractionSchema.safeParse(extractPayload(body));

    if (!parsed.success) {
      return {
        status: 'failed',
        reason: 'The analyzer returned data in an unexpected shape',
        retryable: true,
      };
    }

    if (parsed.data.blocks.every((block) => block.exercises.length === 0)) {
      return { status: 'no_workout_detected', detectedMovements: parsed.data.detectedMovements };
    }

    return { status: 'ok', result: parsed.data };
  }
}

/** The evidence bundle handed to the model, in the PRD's source priority order (§10). */
function buildInput(media: ProcessedMedia): Record<string, unknown> {
  return {
    transcript: media.transcript,
    onScreenText: media.onScreenText,
    caption: media.captionText ?? null,
    visualObservations: media.visualObservations,
    durationSeconds: media.durationSeconds ?? null,
  };
}

/** Vendors wrap their payloads differently; normalise before validating. */
function extractPayload(body: unknown): unknown {
  if (body && typeof body === 'object' && 'output' in body) {
    return (body as { output: unknown }).output;
  }
  return body;
}
