import { z } from 'zod';
import { extracted, type ExtractedField, type FieldSource } from '../schema/provenance';
import type {
  RawExtractedBlock,
  RawExtractedExercise,
  StructuredWorkoutExtraction,
} from '../schema/extraction';
import { BLOCK_KINDS, WORKOUT_STRUCTURES } from '../schema/workout';

/**
 * The wire contract between the model and this application.
 *
 * Deliberately NOT the internal domain schema. Three reasons:
 *
 *   1. Structured outputs need a schema that converts cleanly to JSON Schema —
 *      every field required, `additionalProperties: false`, no `.default()` and no
 *      optional objects. The domain schema is none of those things.
 *   2. "Not specified" has to be expressible. Here it is `value: null` on a field
 *      that is always present, which is far harder for a model to get wrong than
 *      "omit the key entirely".
 *   3. The domain schema is free to evolve without renegotiating with the model.
 *
 * Note what the model is NOT given: `needsReview` and the `user` source. Review
 * status is derived from confidence by `extracted()`, in one place, and nothing but
 * an actual user edit may ever claim `source: 'user'`. Those rules are ours to
 * enforce, not the model's to report.
 */

/** Sources a model may legitimately cite. `user` is deliberately absent. */
export const WIRE_SOURCES = [
  'speech',
  'onscreen_text',
  'caption',
  'visual_identification',
] as const;

const wireSource = z.enum(WIRE_SOURCES);

const numberField = z.object({
  value: z.number().nullable().describe('The stated number, or null if never stated.'),
  source: wireSource,
  confidence: z.number().min(0).max(1),
});

const stringField = z.object({
  value: z.string().nullable().describe('The stated text, or null if never stated.'),
  source: wireSource,
  confidence: z.number().min(0).max(1),
});

const wireExercise = z.object({
  name: stringField.describe('The movement name.'),
  sets: numberField.describe('Sets, only if the creator stated a number of sets.'),
  reps: numberField.describe('Reps per set, for a movement counted straight through.'),
  repsPerSide: numberField.describe('Reps per side, for a unilateral movement.'),
  durationSeconds: numberField.describe('Hold or work duration in seconds, if timed.'),
  restSeconds: numberField.describe('Rest after this exercise, only if stated.'),
  weight: stringField.describe('Load or resistance, in the creator’s own words.'),
  formCues: z.array(stringField).describe('Coaching cues in the creator’s own words.'),
});

const wireBlock = z.object({
  kind: z.enum(BLOCK_KINDS),
  rounds: numberField.describe('Times through the whole block, only if stated.'),
  restBetweenRoundsSeconds: numberField.describe('Rest after each round, only if stated.'),
  exercises: z.array(wireExercise).min(1),
});

export const wireExtractionSchema = z.object({
  workoutDetected: z
    .boolean()
    .describe('False when the content is fitness-related but has no performable workout.'),
  title: z.string().describe('A short title for the workout.'),
  structure: z.enum(WORKOUT_STRUCTURES),
  blocks: z.array(wireBlock),
  workoutNotes: z.array(stringField),
  detectedMovements: z
    .array(z.string())
    .describe('Every movement observed, including ones left out of the blocks.'),
});

export type WireExtraction = z.infer<typeof wireExtractionSchema>;

/* ------------------------------------------------------------------ *
 * Mapping wire → domain
 * ------------------------------------------------------------------ */

/**
 * A null value means the creator never stated it. We drop the field entirely rather
 * than carrying a null placeholder, so "not specified" is represented one way in the
 * domain instead of two.
 */
function toField<T>(
  wire: { value: T | null; source: string; confidence: number },
): ExtractedField<T> | undefined {
  if (wire.value === null) return undefined;
  return extracted<T>(wire.value, wire.source as FieldSource, wire.confidence);
}

function toExercise(wire: WireExtraction['blocks'][number]['exercises'][number]): RawExtractedExercise {
  const exercise: RawExtractedExercise = {
    // A movement always needs a name. If the model returned null, say so plainly
    // rather than inventing one — the review screen can prompt for it.
    name: toField<string>(wire.name) ?? extracted<string>(null, 'visual_identification'),
    formCues: wire.formCues
      .map((cue) => toField<string>(cue))
      .filter((cue): cue is ExtractedField<string> => cue !== undefined),
    notes: [],
  };

  const sets = toField<number>(wire.sets);
  const reps = toField<number>(wire.reps);
  const repsPerSide = toField<number>(wire.repsPerSide);
  const durationSeconds = toField<number>(wire.durationSeconds);
  const restSeconds = toField<number>(wire.restSeconds);
  const weight = toField<string>(wire.weight);

  if (sets) exercise.sets = sets;
  if (reps) exercise.reps = reps;
  if (repsPerSide) exercise.repsPerSide = repsPerSide;
  if (durationSeconds) exercise.durationSeconds = durationSeconds;
  if (restSeconds) exercise.restSeconds = restSeconds;
  if (weight) exercise.weight = weight;

  return exercise;
}

function toBlock(wire: WireExtraction['blocks'][number]): RawExtractedBlock {
  const block: RawExtractedBlock = {
    kind: wire.kind,
    exercises: wire.exercises.map(toExercise),
  };

  const rounds = toField<number>(wire.rounds);
  const restBetweenRoundsSeconds = toField<number>(wire.restBetweenRoundsSeconds);
  if (rounds) block.rounds = rounds;
  if (restBetweenRoundsSeconds) block.restBetweenRoundsSeconds = restBetweenRoundsSeconds;

  return block;
}

export function toStructuredExtraction(wire: WireExtraction): StructuredWorkoutExtraction {
  return {
    title: wire.title.trim() || 'Imported Workout',
    structure: wire.structure,
    blocks: wire.blocks.map(toBlock),
    workoutNotes: wire.workoutNotes
      .map((note) => toField<string>(note))
      .filter((note): note is ExtractedField<string> => note !== undefined),
    detectedMovements: wire.detectedMovements,
  };
}

/**
 * A model can say "I found fitness content but no workout" in two ways: the flag, or
 * an empty block list. Treat both the same so the caller has one thing to check.
 */
export function isNoWorkoutDetected(wire: WireExtraction): boolean {
  return (
    !wire.workoutDetected ||
    wire.blocks.length === 0 ||
    wire.blocks.every((block) => block.exercises.length === 0)
  );
}
