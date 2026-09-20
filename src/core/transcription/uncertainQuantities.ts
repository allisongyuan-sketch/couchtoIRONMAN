import type { TranscriptUtterance, TranscriptWord } from './types';

/**
 * Find numbers the transcriber was not sure it heard correctly.
 *
 * This is the mechanism behind PRD §9, which uses exactly this example: the creator
 * said either "12 reps" or "20 reps" and speech recognition cannot tell. The right
 * behaviour is not to pick one — it is to show "Reps: Unclear ⚠️" and offer Review
 * Original.
 *
 * For that to happen, the uncertainty has to survive the trip from the transcriber to
 * the extraction model. A confidence score buried in an utterance average will not do
 * it: one shaky word in a confident sentence disappears into the mean. So the shaky
 * *numbers* are pulled out and handed to the model explicitly.
 */

/**
 * Deliberately stricter than the general review threshold (0.75).
 *
 * A misheard ordinary word is a cosmetic problem. A misheard number changes what the
 * user actually does — fifteen reps instead of fifty — so numbers get less benefit of
 * the doubt than prose does.
 */
export const QUANTITY_CONFIDENCE_THRESHOLD = 0.85;

/** Spelled-out numerals, since a transcriber may emit either form. */
const NUMBER_WORDS = new Set([
  'zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine',
  'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen',
  'seventeen', 'eighteen', 'nineteen', 'twenty', 'thirty', 'forty', 'fifty',
  'sixty', 'seventy', 'eighty', 'ninety', 'hundred',
]);

export interface UncertainQuantity {
  /** The number as it was heard. */
  text: string;
  atSeconds: number;
  confidence: number;
  /** Surrounding words, so the model can tell a rep count from a rest duration. */
  context: string;
}

export function isQuantityWord(word: string): boolean {
  const lowered = word.toLowerCase();
  if (/\d/.test(lowered)) return true;
  // Split on the separators rather than stripping them: "twenty-five" has to become
  // two tokens, not "twentyfive".
  return lowered
    .split(/[^a-z]+/)
    .some((part) => part.length > 0 && NUMBER_WORDS.has(part));
}

export function findUncertainQuantities(
  utterances: TranscriptUtterance[],
  threshold = QUANTITY_CONFIDENCE_THRESHOLD,
): UncertainQuantity[] {
  const found: UncertainQuantity[] = [];

  for (const utterance of utterances) {
    utterance.words.forEach((word, index) => {
      if (!isQuantityWord(word.text)) return;
      if (word.confidence >= threshold) return;

      found.push({
        text: word.text,
        atSeconds: Number(word.startSeconds.toFixed(2)),
        confidence: Number(word.confidence.toFixed(2)),
        context: contextAround(utterance.words, index),
      });
    });
  }

  return found;
}

/** A few words either side — enough to disambiguate "60 seconds" from "60 reps". */
function contextAround(words: TranscriptWord[], index: number, radius = 4): string {
  return words
    .slice(Math.max(0, index - radius), index + radius + 1)
    .map((word) => word.text)
    .join(' ');
}

/**
 * Collapse an utterance list into the coarser segments the extraction stage consumes.
 *
 * Utterance-level confidence is the mean of its words, which is the right granularity
 * for "how much do I trust this sentence" — the per-number detail is carried
 * separately by `findUncertainQuantities`, precisely because averaging would hide it.
 */
export function toTranscriptSegments(
  utterances: TranscriptUtterance[],
): { startSeconds: number; endSeconds: number; text: string; confidence: number }[] {
  return utterances.map((utterance) => ({
    startSeconds: utterance.startSeconds,
    endSeconds: utterance.endSeconds,
    text: utterance.text,
    confidence: utterance.confidence,
  }));
}
