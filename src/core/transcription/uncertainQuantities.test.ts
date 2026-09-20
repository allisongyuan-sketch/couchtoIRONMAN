import { describe, expect, it } from 'vitest';
import {
  findUncertainQuantities,
  isQuantityWord,
  QUANTITY_CONFIDENCE_THRESHOLD,
  toTranscriptSegments,
} from './uncertainQuantities';
import type { TranscriptUtterance, TranscriptWord } from './types';

function word(text: string, confidence = 0.99, startSeconds = 0): TranscriptWord {
  return { text, confidence, startSeconds, endSeconds: startSeconds + 0.3 };
}

function utterance(words: TranscriptWord[]): TranscriptUtterance {
  return {
    text: words.map((entry) => entry.text).join(' '),
    startSeconds: words[0]?.startSeconds ?? 0,
    endSeconds: words[words.length - 1]?.endSeconds ?? 0,
    confidence: words.reduce((sum, entry) => sum + entry.confidence, 0) / (words.length || 1),
    words,
  };
}

describe('isQuantityWord', () => {
  it('recognises digits and spelled-out numerals', () => {
    for (const text of ['12', '45', 'twelve', 'Twenty', 'fifty,', 'twenty-five', '3x']) {
      expect(isQuantityWord(text), text).toBe(true);
    }
  });

  it('ignores ordinary words', () => {
    for (const text of ['squat', 'reps', 'side', '', '—']) {
      expect(isQuantityWord(text), text).toBe(false);
    }
  });
});

describe('findUncertainQuantities', () => {
  it('flags a number the transcriber was unsure of', () => {
    // The PRD §9 case: "12 reps" or "20 reps"? Do not pick one.
    const found = findUncertainQuantities([
      utterance([
        word('do', 0.99, 0),
        word('twelve', 0.58, 0.4),
        word('reps', 0.98, 0.8),
        word('per', 0.97, 1.1),
        word('side', 0.99, 1.3),
      ]),
    ]);

    expect(found).toHaveLength(1);
    expect(found[0]?.text).toBe('twelve');
    expect(found[0]?.confidence).toBe(0.58);
    // Context is what lets the model tell a rep count from a rest duration.
    expect(found[0]?.context).toContain('reps');
    expect(found[0]?.atSeconds).toBe(0.4);
  });

  it('leaves confident numbers alone', () => {
    const found = findUncertainQuantities([
      utterance([word('three', 0.97, 0), word('rounds', 0.98, 0.4)]),
    ]);
    expect(found).toEqual([]);
  });

  it('ignores a shaky word that is not a number', () => {
    // Mishearing "Bulgarian" is cosmetic. Mishearing "fifteen" is not.
    const found = findUncertainQuantities([
      utterance([word('Bulgarian', 0.41, 0), word('split', 0.99, 0.5), word('squat', 0.99, 0.9)]),
    ]);
    expect(found).toEqual([]);
  });

  it('holds numbers to a stricter standard than prose', () => {
    // A number at 0.8 passes the general review threshold but not this one.
    expect(QUANTITY_CONFIDENCE_THRESHOLD).toBeGreaterThan(0.75);
    const found = findUncertainQuantities([utterance([word('fifty', 0.8, 0)])]);
    expect(found).toHaveLength(1);
  });

  it('finds a shaky number hidden inside a confident sentence', () => {
    // The reason this exists: the utterance average here is ~0.9, which would sail
    // past any sentence-level check while the one number that matters is a guess.
    const sentence = utterance([
      word('rest', 0.99, 0),
      word('for', 0.99, 0.3),
      word('sixty', 0.52, 0.6),
      word('seconds', 0.99, 1.0),
      word('between', 0.99, 1.4),
      word('rounds', 0.99, 1.8),
    ]);

    expect(sentence.confidence).toBeGreaterThan(0.85);
    expect(findUncertainQuantities([sentence])).toHaveLength(1);
  });

  it('reports every shaky number across the whole transcript', () => {
    const found = findUncertainQuantities([
      utterance([word('twelve', 0.6, 0), word('reps', 0.99, 0.4)]),
      utterance([word('rest', 0.99, 2), word('45', 0.5, 2.4), word('seconds', 0.99, 2.8)]),
    ]);
    expect(found.map((entry) => entry.text)).toEqual(['twelve', '45']);
  });
});

describe('toTranscriptSegments', () => {
  it('keeps timing and confidence for the extraction stage', () => {
    const segments = toTranscriptSegments([
      utterance([word('three', 0.9, 1), word('rounds', 0.9, 1.5)]),
    ]);

    expect(segments).toHaveLength(1);
    expect(segments[0]?.text).toBe('three rounds');
    expect(segments[0]?.startSeconds).toBe(1);
    expect(segments[0]?.confidence).toBeCloseTo(0.9);
  });
});
