import { describe, expect, it } from 'vitest';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import {
  isNoWorkoutDetected,
  toStructuredExtraction,
  wireExtractionSchema,
  WIRE_SOURCES,
  type WireExtraction,
} from './wire';
import { structuredWorkoutExtractionSchema } from '../schema/extraction';
import { REVIEW_CONFIDENCE_THRESHOLD } from '../schema/provenance';

type WireSource = (typeof WIRE_SOURCES)[number];

function field<T>(
  value: T | null,
  source: WireSource = 'speech',
  confidence = 0.9,
): { value: T | null; source: WireSource; confidence: number } {
  return { value, source, confidence };
}

function wireWith(overrides: Partial<WireExtraction> = {}): WireExtraction {
  return {
    workoutDetected: true,
    title: 'Test Workout',
    structure: 'circuit',
    blocks: [
      {
        kind: 'circuit',
        rounds: field(3),
        restBetweenRoundsSeconds: field(60),
        exercises: [
          {
            name: field('Bulgarian Split Squat'),
            sets: field(null),
            reps: field(null),
            repsPerSide: field(10),
            durationSeconds: field(null),
            restSeconds: field(null),
            weight: field(null),
            formCues: [field('Keep your torso slightly forward.')],
          },
        ],
      },
    ],
    workoutNotes: [],
    detectedMovements: ['Bulgarian Split Squat'],
    ...overrides,
  };
}

describe('wire contract', () => {
  it('converts to a JSON schema the structured-outputs API will accept', () => {
    // Structured outputs require a closed schema. If a future edit to the wire
    // schema introduces an optional or a default, this catches it here rather
    // than as a 400 from the API in production.
    const format = zodOutputFormat(wireExtractionSchema);
    const serialized = JSON.stringify(format);

    expect(format.type).toBe('json_schema');
    expect(serialized).toContain('"additionalProperties":false');
    expect(serialized).not.toContain('"default"');
  });

  it('never offers the model a "user" source', () => {
    // Only an actual human edit may claim source 'user'. If the model could claim
    // it, a fabricated value would render as a user's own correction.
    expect(JSON.stringify(zodOutputFormat(wireExtractionSchema))).not.toContain('"user"');
  });

  it('maps a populated wire payload into a valid domain extraction', () => {
    const result = toStructuredExtraction(wireWith());
    expect(structuredWorkoutExtractionSchema.safeParse(result).success).toBe(true);

    const exercise = result.blocks[0]!.exercises[0]!;
    expect(exercise.repsPerSide?.value).toBe(10);
    expect(result.blocks[0]!.rounds?.value).toBe(3);
    expect(exercise.formCues[0]?.value).toBe('Keep your torso slightly forward.');
  });

  it('drops null values instead of carrying null placeholders', () => {
    // "Not specified" must have exactly one representation in the domain.
    const exercise = toStructuredExtraction(wireWith()).blocks[0]!.exercises[0]!;
    expect(exercise.sets).toBeUndefined();
    expect(exercise.reps).toBeUndefined();
    expect(exercise.restSeconds).toBeUndefined();
    expect(exercise.weight).toBeUndefined();
  });

  it('derives needsReview from confidence rather than trusting the model', () => {
    const low = wireWith({
      blocks: [
        {
          kind: 'circuit',
          rounds: field(3),
          restBetweenRoundsSeconds: field(null),
          exercises: [
            {
              name: field('Bicycle Crunch'),
              sets: field(null),
              reps: field(12, 'speech', 0.61),
              repsPerSide: field(null),
              durationSeconds: field(null),
              restSeconds: field(null),
              weight: field(null),
              formCues: [],
            },
          ],
        },
      ],
    });

    const reps = toStructuredExtraction(low).blocks[0]!.exercises[0]!.reps;
    expect(reps?.value).toBe(12);
    expect(reps?.confidence).toBeLessThan(REVIEW_CONFIDENCE_THRESHOLD);
    expect(reps?.needsReview).toBe(true);
  });

  it('keeps a nameless movement rather than inventing a name', () => {
    const nameless = wireWith({
      blocks: [
        {
          kind: 'flow',
          rounds: field(null),
          restBetweenRoundsSeconds: field(null),
          exercises: [
            {
              name: field(null),
              sets: field(null),
              reps: field(null),
              repsPerSide: field(null),
              durationSeconds: field(null),
              restSeconds: field(null),
              weight: field(null),
              formCues: [],
            },
          ],
        },
      ],
    });

    const name = toStructuredExtraction(nameless).blocks[0]!.exercises[0]!.name;
    expect(name.value).toBeNull();
  });

  it('recognises "no workout detected" from either signal', () => {
    expect(isNoWorkoutDetected(wireWith({ workoutDetected: false }))).toBe(true);
    expect(isNoWorkoutDetected(wireWith({ blocks: [] }))).toBe(true);
    expect(isNoWorkoutDetected(wireWith())).toBe(false);
  });
});
