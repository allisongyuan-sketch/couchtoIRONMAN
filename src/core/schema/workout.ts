import { z } from 'zod';
import {
  type ExtractedField,
  extractedFieldSchema,
  notSpecified,
  valueOr,
} from './provenance';

/* ------------------------------------------------------------------ *
 * Source content — attribution that survives conversion (PRD §3.4, §33)
 * ------------------------------------------------------------------ */

export const PLATFORMS = ['tiktok', 'instagram', 'youtube', 'upload', 'other'] as const;
export type Platform = (typeof PLATFORMS)[number];
export const platformSchema = z.enum(PLATFORMS);

export const workoutSourceSchema = z.object({
  platform: platformSchema,
  url: z.string().optional(),
  creatorHandle: z.string().optional(),
  caption: z.string().optional(),
  thumbnailUrl: z.string().optional(),
  sourceTitle: z.string().optional(),
});
export type WorkoutSource = z.infer<typeof workoutSourceSchema>;

/* ------------------------------------------------------------------ *
 * The Exercise catalog
 *
 * A movement is NOT owned by a workout (PRD §27). "Bulgarian Split Squat" is one
 * entity that many workouts reference; the prescription (3 × 10/side) belongs to
 * the workout. Keeping these apart today is what lets the catalog later carry demo
 * media, muscle groups and shared cues without a migration.
 * ------------------------------------------------------------------ */

export const exerciseSchema = z.object({
  id: z.string(),
  /** Canonical dedupe key, e.g. "bulgarian-split-squat". */
  slug: z.string(),
  displayName: z.string(),
});
export type Exercise = z.infer<typeof exerciseSchema>;

/* ------------------------------------------------------------------ *
 * WorkoutExercise — the prescription
 * ------------------------------------------------------------------ */

const numberField = extractedFieldSchema(z.number());
const stringField = extractedFieldSchema(z.string());

export const workoutExerciseSchema = z.object({
  id: z.string(),
  /** Reference into the Exercise catalog. */
  exerciseId: z.string(),
  /** How this movement's name was determined for THIS workout (speech? visual?). */
  name: stringField,
  sets: numberField.optional(),
  reps: numberField.optional(),
  repsPerSide: numberField.optional(),
  durationSeconds: numberField.optional(),
  restSeconds: numberField.optional(),
  weight: stringField.optional(),
  resistance: stringField.optional(),
  /** Creator-provided coaching. Never AI-authored (PRD §21). */
  formCues: z.array(stringField),
  notes: z.array(stringField),
  order: z.number().int().min(0),
});

export interface WorkoutExercise {
  id: string;
  exerciseId: string;
  name: ExtractedField<string>;
  sets?: ExtractedField<number>;
  reps?: ExtractedField<number>;
  repsPerSide?: ExtractedField<number>;
  durationSeconds?: ExtractedField<number>;
  restSeconds?: ExtractedField<number>;
  weight?: ExtractedField<string>;
  resistance?: ExtractedField<string>;
  formCues: ExtractedField<string>[];
  notes: ExtractedField<string>[];
  order: number;
}

/* ------------------------------------------------------------------ *
 * Blocks — how the workout is actually organised
 *
 * A flat exercise list cannot express "these three, back-to-back, four rounds".
 * The block is what makes PRD §22 and the §41 acceptance test expressible:
 * a circuit is ONE block with rounds = 3, not three exercises that each happen
 * to claim "3 sets". The difference is load-bearing at execution time — a circuit
 * rests after the round, straight sets rest after each set.
 * ------------------------------------------------------------------ */

export const BLOCK_KINDS = [
  'straight_sets',
  'circuit',
  'superset',
  'interval',
  'amrap',
  'emom',
  'flow',
] as const;
export type BlockKind = (typeof BLOCK_KINDS)[number];
export const blockKindSchema = z.enum(BLOCK_KINDS);

export const workoutBlockSchema = z.object({
  id: z.string(),
  kind: blockKindSchema,
  label: z.string().optional(),
  /** Times through the whole block. Meaningful for circuit / superset / interval. */
  rounds: numberField.optional(),
  restBetweenRoundsSeconds: numberField.optional(),
  /** Time cap for amrap / emom / timed blocks. */
  capSeconds: numberField.optional(),
  exercises: z.array(workoutExerciseSchema),
  order: z.number().int().min(0),
});

export interface WorkoutBlock {
  id: string;
  kind: BlockKind;
  label?: string;
  rounds?: ExtractedField<number>;
  restBetweenRoundsSeconds?: ExtractedField<number>;
  capSeconds?: ExtractedField<number>;
  exercises: WorkoutExercise[];
  order: number;
}

/* ------------------------------------------------------------------ *
 * Workout
 * ------------------------------------------------------------------ */

export const WORKOUT_STRUCTURES = [
  'straight_sets',
  'circuit',
  'superset',
  'interval',
  'amrap',
  'emom',
  'timed',
  'flow',
  'unknown',
] as const;
export type WorkoutStructure = (typeof WORKOUT_STRUCTURES)[number];
export const workoutStructureSchema = z.enum(WORKOUT_STRUCTURES);

export const workoutSchema = z.object({
  id: z.string(),
  title: z.string(),
  source: workoutSourceSchema,
  /** Summary label for display and future filtering. `blocks` is the executable truth. */
  structure: workoutStructureSchema,
  blocks: z.array(workoutBlockSchema),
  workoutNotes: z.array(stringField),
  /** Links back to the Extraction that produced this, for edit-rate analysis. */
  extractionId: z.string().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
  lastPerformedAt: z.string().optional(),
});

export interface Workout {
  id: string;
  title: string;
  source: WorkoutSource;
  structure: WorkoutStructure;
  blocks: WorkoutBlock[];
  workoutNotes: ExtractedField<string>[];
  extractionId?: string;
  createdAt: string;
  updatedAt: string;
  lastPerformedAt?: string;
}

/* ------------------------------------------------------------------ *
 * Derived helpers — read-only views the UI leans on
 * ------------------------------------------------------------------ */

export function allExercises(workout: Workout): WorkoutExercise[] {
  return [...workout.blocks]
    .sort((a, b) => a.order - b.order)
    .flatMap((block) => [...block.exercises].sort((a, b) => a.order - b.order));
}

export function exerciseCount(workout: Workout): number {
  return workout.blocks.reduce((sum, block) => sum + block.exercises.length, 0);
}

/**
 * Rounds default to 1 when unstated — this is not an invented prescription, it is the
 * minimum coherent reading of "do this block". We never claim the creator said "1 round".
 */
export function blockRounds(block: WorkoutBlock): number {
  return Math.max(1, valueOr(block.rounds, 1));
}

/** Same reasoning as blockRounds: one set is the floor for "perform this exercise". */
export function exerciseSets(exercise: WorkoutExercise): number {
  return Math.max(1, valueOr(exercise.sets, 1));
}

/** True when the creator gave us no prescription at all — drives review warnings. */
export function hasNoPrescription(exercise: WorkoutExercise): boolean {
  return (
    exercise.reps?.value == null &&
    exercise.repsPerSide?.value == null &&
    exercise.durationSeconds?.value == null
  );
}

/** A short human summary: "3 sets × 10 reps / side", "45 sec", "Reps: Not specified". */
export function prescriptionSummary(exercise: WorkoutExercise): string {
  const parts: string[] = [];
  const sets = exercise.sets?.value;
  if (sets != null) parts.push(`${sets} ${sets === 1 ? 'set' : 'sets'}`);

  if (exercise.repsPerSide?.value != null) {
    parts.push(`${exercise.repsPerSide.value} reps / side`);
  } else if (exercise.reps?.value != null) {
    parts.push(`${exercise.reps.value} reps`);
  } else if (exercise.durationSeconds?.value != null) {
    parts.push(formatDuration(exercise.durationSeconds.value));
  } else {
    return sets != null ? `${parts[0]} · Reps: Not specified` : 'Reps: Not specified';
  }

  return parts.join(' × ');
}

export function formatDuration(totalSeconds: number): string {
  const safe = Math.max(0, Math.round(totalSeconds));
  if (safe < 60) return `${safe} sec`;
  const minutes = Math.floor(safe / 60);
  const seconds = safe % 60;
  return seconds === 0 ? `${minutes} min` : `${minutes} min ${seconds} sec`;
}

export function formatClock(totalSeconds: number): string {
  const safe = Math.max(0, Math.ceil(totalSeconds));
  const minutes = Math.floor(safe / 60);
  const seconds = safe % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

export function emptyWorkoutExercise(
  overrides: Partial<WorkoutExercise> & Pick<WorkoutExercise, 'id' | 'exerciseId' | 'order'>,
): WorkoutExercise {
  return {
    name: notSpecified<string>('user'),
    formCues: [],
    notes: [],
    ...overrides,
  };
}
