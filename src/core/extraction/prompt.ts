import type { ProcessedMedia } from './service';

/**
 * The extraction prompt and the evidence bundle.
 *
 * Kept pure and separate from the API call so both can be tested, and so the prompt
 * stays a stable cacheable prefix (see `anthropicExtractor`).
 */

/**
 * The instruction half of "extract, don't invent".
 *
 * Every rule here is also enforced mechanically by `applyGuardrails` after the model
 * answers. Both exist on purpose: the prompt is how we ask for the right behaviour,
 * the guardrail is how we guarantee it. A prompt degrades silently; a guardrail does not.
 *
 * Treat this string as frozen — it is the cache prefix for every extraction request,
 * so an incidental edit costs a cache miss on all of them.
 */
export const EXTRACTION_SYSTEM_PROMPT = `You convert short-form fitness video into a structured workout that someone can perform without rewatching the video.

You receive whatever evidence could be gathered: a speech transcript with timings and confidence, text burned into the video frames, the caption, and sampled frames from the video itself. Any of these may be missing.

Where two sources disagree, prefer the one the creator stated most explicitly: speech and on-screen text outrank a caption, and all three outrank anything you infer from watching.

## What you must return

Structured data only, matching the provided schema.

Every field carries a "source" and a "confidence" alongside its value. Set them honestly — they are shown to the user and they determine what the app is willing to state as fact.

## The rules

1. **Extract, do not invent.** Record sets, reps, durations, rest, load or rounds ONLY when the creator actually stated them — in speech, in on-screen text, or in the caption. If the creator never said it, return null for that field. Never supply a typical, reasonable or default value. A workout with unknown reps is a correct result; a workout with invented reps is a defect.

2. **You may name a movement you can only see.** If the creator silently demonstrates an exercise, identify it and set source to "visual_identification". This is the one thing visual evidence may establish on its own.

3. **You may not count with your eyes.** Watching ten repetitions is not the creator prescribing ten repetitions. Any quantity whose only evidence is visual must be null. The same applies to rounds and to rest.

4. **Reading text is not seeing.** Text burned into a frame is something the creator wrote. A prescription you read in the frame is real: use source "onscreen_text". Reserve "visual_identification" for what you infer from bodies and movement, not from words.

5. **Cues must be the creator's own words.** Quote them, with the source you heard or read them in. Never write your own coaching, your own modifications, or any medical or safety advice. If the creator gave no cues, return an empty list.

6. **Say when you are unsure.** If the audio was ambiguous between two numbers, return your best reading with a low confidence rather than a confident guess. Low confidence is how the app knows to ask the user instead of asserting.

   Two things in the evidence tell you when to do this. Each transcript entry carries a "confidence" for the sentence. Separately, "uncertainQuantities" lists individual numbers the transcriber was not sure it heard correctly — a number listed there was a coin flip between two readings, so any value you take from it must carry a confidence below 0.7 even if the surrounding sentence was clear. Do not quietly resolve the ambiguity; the app is built to ask.

7. **Represent the structure.** If exercises are performed back-to-back for several rounds, return ONE block of kind "circuit" with the stated rounds — not several separate exercises that each repeat. Use "straight_sets" only when each exercise is completed for all its sets before moving on. Match the creator's actual organisation.

8. **Distinguish reps from reps-per-side.** "Ten each side" is repsPerSide: 10, not reps: 20.

## When there is no workout

If the content is fitness-related but contains no performable workout — a talking-head clip, a form critique, a highlight reel — set workoutDetected to false and list everything you observed in detectedMovements. Do not assemble a workout out of fragments.`;

export interface EvidenceBundle {
  transcript: { atSeconds: number; text: string; confidence?: number }[];
  /**
   * Individual numbers the transcriber flagged as uncertain. Surfaced separately
   * because a sentence-level confidence average hides exactly the case PRD §9 cares
   * about: one shaky number in an otherwise clean sentence.
   */
  uncertainQuantities: { heard: string; atSeconds: number; confidence: number; context: string }[];
  onScreenText: { atSeconds: number; text: string }[];
  caption: string | null;
  durationSeconds: number | null;
  /** What the app already knows, so the model does not have to guess it. */
  platform: string;
  creatorHandle: string | null;
}

/**
 * The textual evidence, as JSON.
 *
 * Timestamps are included because alignment matters: "three rounds" said at 0:02
 * governs the exercises that follow it, and a cue at 0:14 belongs to whichever
 * movement is on screen then.
 */
export function buildEvidence(media: ProcessedMedia): EvidenceBundle {
  return {
    transcript: media.transcript.map((segment) => {
      const entry: EvidenceBundle['transcript'][number] = {
        atSeconds: Math.round(segment.startSeconds),
        text: segment.text,
      };
      if (segment.confidence !== undefined) {
        entry.confidence = Number(segment.confidence.toFixed(2));
      }
      return entry;
    }),
    uncertainQuantities: media.uncertainQuantities.map((quantity) => ({
      heard: quantity.text,
      atSeconds: quantity.atSeconds,
      confidence: quantity.confidence,
      context: quantity.context,
    })),
    onScreenText: media.onScreenText.map((entry) => ({
      atSeconds: Math.round(entry.startSeconds),
      text: entry.text,
    })),
    caption: media.captionText ?? null,
    durationSeconds: media.durationSeconds ?? null,
    platform: media.source.platform,
    creatorHandle: media.source.creatorHandle ?? null,
  };
}

/**
 * Is there anything here worth spending a request on?
 *
 * Calling a model with no transcript, no text and no frames would be asking it to
 * invent a workout from a URL. We would rather report that we could not analyze the
 * video (PRD §31) than pay for a hallucination.
 */
export function hasAnalyzableEvidence(media: ProcessedMedia): boolean {
  return (
    media.transcript.length > 0 ||
    media.onScreenText.length > 0 ||
    media.frames.length > 0 ||
    (media.captionText?.trim().length ?? 0) > 0
  );
}

/** A short note telling the model which evidence is absent, so silence is not ambiguous. */
export function describeGaps(media: ProcessedMedia): string {
  const missing: string[] = [];
  if (media.transcript.length === 0) {
    missing.push('no speech transcript is available — the video may be silent');
  }
  if (media.onScreenText.length === 0 && media.frames.length === 0) {
    missing.push('no on-screen text was extracted');
  }
  if (!media.captionText) missing.push('no caption is available');

  if (missing.length === 0) return '';
  return `Note: ${missing.join(', ')}. Do not compensate by guessing — leave unstated values null.`;
}
