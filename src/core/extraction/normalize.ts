import { createId, slugify } from '../util/id';
import type { RawExtractedExercise, StructuredWorkoutExtraction } from '../schema/extraction';
import type {
  Exercise,
  Workout,
  WorkoutBlock,
  WorkoutExercise,
  WorkoutSource,
} from '../schema/workout';

/**
 * Turn a validated, guarded extraction into the app's domain objects.
 *
 * Two things happen here that the model is deliberately not trusted with:
 * identity (ids are ours) and catalog linkage (movements are deduped by slug so the
 * Exercise catalog can be shared across workouts — PRD §27).
 */

export interface NormalizedExtraction {
  workout: Workout;
  /** New or matched catalog entries referenced by this workout. */
  exercises: Exercise[];
}

export function normalizeExtraction(
  raw: StructuredWorkoutExtraction,
  source: WorkoutSource,
  options: { extractionId?: string; now?: Date; workoutId?: string } = {},
): NormalizedExtraction {
  const timestamp = (options.now ?? new Date()).toISOString();
  const catalog = new Map<string, Exercise>();

  const blocks: WorkoutBlock[] = raw.blocks.map((rawBlock, blockIndex) => {
    const blockId = createId('blk');

    const exercises: WorkoutExercise[] = rawBlock.exercises.map((rawExercise, exerciseIndex) => {
      const catalogEntry = resolveCatalogEntry(catalog, rawExercise);
      return toWorkoutExercise(rawExercise, catalogEntry.id, exerciseIndex);
    });

    const block: WorkoutBlock = {
      id: blockId,
      kind: rawBlock.kind,
      exercises,
      order: blockIndex,
    };
    if (rawBlock.label) block.label = rawBlock.label;
    if (rawBlock.rounds) block.rounds = rawBlock.rounds;
    if (rawBlock.restBetweenRoundsSeconds) {
      block.restBetweenRoundsSeconds = rawBlock.restBetweenRoundsSeconds;
    }
    if (rawBlock.capSeconds) block.capSeconds = rawBlock.capSeconds;
    return block;
  });

  const workout: Workout = {
    id: options.workoutId ?? createId('wk'),
    title: raw.title,
    source,
    structure: raw.structure,
    blocks,
    workoutNotes: raw.workoutNotes,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
  if (options.extractionId) workout.extractionId = options.extractionId;

  return { workout, exercises: [...catalog.values()] };
}

function resolveCatalogEntry(
  catalog: Map<string, Exercise>,
  rawExercise: RawExtractedExercise,
): Exercise {
  const displayName = rawExercise.name.value?.trim() || 'Unnamed movement';
  const slug = slugify(displayName) || 'unnamed-movement';

  const existing = catalog.get(slug);
  if (existing) return existing;

  const entry: Exercise = { id: createId('ex'), slug, displayName };
  catalog.set(slug, entry);
  return entry;
}

function toWorkoutExercise(
  raw: RawExtractedExercise,
  exerciseId: string,
  order: number,
): WorkoutExercise {
  const exercise: WorkoutExercise = {
    id: createId('wex'),
    exerciseId,
    name: raw.name,
    formCues: raw.formCues,
    notes: raw.notes,
    order,
  };

  if (raw.sets) exercise.sets = raw.sets;
  if (raw.reps) exercise.reps = raw.reps;
  if (raw.repsPerSide) exercise.repsPerSide = raw.repsPerSide;
  if (raw.durationSeconds) exercise.durationSeconds = raw.durationSeconds;
  if (raw.restSeconds) exercise.restSeconds = raw.restSeconds;
  if (raw.weight) exercise.weight = raw.weight;
  if (raw.resistance) exercise.resistance = raw.resistance;

  return exercise;
}
