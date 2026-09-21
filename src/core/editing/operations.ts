import { createId, slugify } from '../util/id';
import { userField, type ExtractedField } from '../schema/provenance';
import {
  emptyWorkoutExercise,
  type Exercise,
  type Workout,
  type WorkoutBlock,
  type WorkoutExercise,
} from '../schema/workout';

/**
 * Pure workout mutation operations (PRD §7).
 *
 * AI extraction will never be perfect, so correction is a first-class feature rather
 * than an escape hatch. Every operation here:
 *
 *   • returns a new Workout (no mutation, so undo and diffing stay possible);
 *   • records the edit with `source: 'user'` and preserves the superseded value,
 *     so creator intent is never destroyed and the edit rate stays measurable;
 *   • touches `updatedAt`.
 *
 * Keeping these as pure functions — rather than methods on a store — is what lets the
 * editor screen stay a rendering concern and lets edits be unit-tested directly.
 */

function touch(workout: Workout): Workout {
  return { ...workout, updatedAt: new Date().toISOString() };
}

function mapExercise(
  workout: Workout,
  workoutExerciseId: string,
  update: (exercise: WorkoutExercise) => WorkoutExercise,
): Workout {
  return touch({
    ...workout,
    blocks: workout.blocks.map((block) => ({
      ...block,
      exercises: block.exercises.map((exercise) =>
        exercise.id === workoutExerciseId ? update(exercise) : exercise,
      ),
    })),
  });
}

function mapBlock(
  workout: Workout,
  blockId: string,
  update: (block: WorkoutBlock) => WorkoutBlock,
): Workout {
  return touch({
    ...workout,
    blocks: workout.blocks.map((block) => (block.id === blockId ? update(block) : block)),
  });
}

/** Assign a user-sourced value, preserving whatever it replaced. */
function override<T>(previous: ExtractedField<T> | undefined, value: T | null): ExtractedField<T> {
  return userField(value, previous);
}

/* ---------------------------------- workout --------------------------------- */

export function setTitle(workout: Workout, title: string): Workout {
  return touch({ ...workout, title });
}

/* --------------------------------- exercises -------------------------------- */

export function setName(workout: Workout, workoutExerciseId: string, name: string): Workout {
  return mapExercise(workout, workoutExerciseId, (exercise) => ({
    ...exercise,
    name: override(exercise.name, name),
  }));
}

export function setSets(
  workout: Workout,
  workoutExerciseId: string,
  sets: number | null,
): Workout {
  return mapExercise(workout, workoutExerciseId, (exercise) => ({
    ...exercise,
    sets: override(exercise.sets, sets),
  }));
}

/**
 * The three prescription modes are mutually exclusive: an exercise is measured in
 * reps, in reps per side, or in time. Setting one clears the others, so the player
 * never has to guess which one the user meant.
 */
export function setReps(
  workout: Workout,
  workoutExerciseId: string,
  reps: number | null,
): Workout {
  return mapExercise(workout, workoutExerciseId, (exercise) => ({
    ...exercise,
    reps: override(exercise.reps, reps),
    repsPerSide: override(exercise.repsPerSide, null),
    durationSeconds: override(exercise.durationSeconds, null),
  }));
}

export function setRepsPerSide(
  workout: Workout,
  workoutExerciseId: string,
  repsPerSide: number | null,
): Workout {
  return mapExercise(workout, workoutExerciseId, (exercise) => ({
    ...exercise,
    repsPerSide: override(exercise.repsPerSide, repsPerSide),
    reps: override(exercise.reps, null),
    durationSeconds: override(exercise.durationSeconds, null),
  }));
}

export function setDurationSeconds(
  workout: Workout,
  workoutExerciseId: string,
  durationSeconds: number | null,
): Workout {
  return mapExercise(workout, workoutExerciseId, (exercise) => ({
    ...exercise,
    durationSeconds: override(exercise.durationSeconds, durationSeconds),
    reps: override(exercise.reps, null),
    repsPerSide: override(exercise.repsPerSide, null),
  }));
}

export function setRestSeconds(
  workout: Workout,
  workoutExerciseId: string,
  restSeconds: number | null,
): Workout {
  return mapExercise(workout, workoutExerciseId, (exercise) => ({
    ...exercise,
    restSeconds: override(exercise.restSeconds, restSeconds),
  }));
}

export function setWeight(
  workout: Workout,
  workoutExerciseId: string,
  weight: string | null,
): Workout {
  return mapExercise(workout, workoutExerciseId, (exercise) => ({
    ...exercise,
    weight: override(exercise.weight, weight),
  }));
}

/** A user-authored note. Distinct from creator cues, which users cannot forge. */
export function addNote(workout: Workout, workoutExerciseId: string, note: string): Workout {
  return mapExercise(workout, workoutExerciseId, (exercise) => ({
    ...exercise,
    notes: [...exercise.notes, userField<string>(note)],
  }));
}

/* ------------------------------ add / remove / move ------------------------- */

export function addExercise(
  workout: Workout,
  blockId: string,
  name: string,
): { workout: Workout; exercise: Exercise } {
  const displayName = name.trim() || 'New exercise';
  const catalogEntry: Exercise = {
    id: createId('ex'),
    slug: slugify(displayName) || 'new-exercise',
    displayName,
  };

  const updated = mapBlock(workout, blockId, (block) => ({
    ...block,
    exercises: [
      ...block.exercises,
      emptyWorkoutExercise({
        id: createId('wex'),
        exerciseId: catalogEntry.id,
        order: block.exercises.length,
        name: userField<string>(displayName),
      }),
    ],
  }));

  return { workout: updated, exercise: catalogEntry };
}

export function deleteExercise(workout: Workout, workoutExerciseId: string): Workout {
  return touch({
    ...workout,
    blocks: workout.blocks.map((block) => ({
      ...block,
      exercises: block.exercises
        .filter((exercise) => exercise.id !== workoutExerciseId)
        .map((exercise, index) => ({ ...exercise, order: index })),
    })),
  });
}

/** Reorder within a block. Returns the workout unchanged at the ends of the list. */
export function moveExercise(
  workout: Workout,
  workoutExerciseId: string,
  direction: 'up' | 'down',
): Workout {
  const blockId = workout.blocks.find((block) =>
    block.exercises.some((exercise) => exercise.id === workoutExerciseId),
  )?.id;
  if (!blockId) return workout;

  return mapBlock(workout, blockId, (block) => {
    const ordered = [...block.exercises].sort((a, b) => a.order - b.order);
    const index = ordered.findIndex((exercise) => exercise.id === workoutExerciseId);
    const target = direction === 'up' ? index - 1 : index + 1;
    if (index < 0 || target < 0 || target >= ordered.length) return block;

    const swapped = [...ordered];
    const moving = swapped[index]!;
    swapped[index] = swapped[target]!;
    swapped[target] = moving;

    return {
      ...block,
      exercises: swapped.map((exercise, position) => ({ ...exercise, order: position })),
    };
  });
}

/* ----------------------------------- blocks --------------------------------- */

export function setBlockRounds(
  workout: Workout,
  blockId: string,
  rounds: number | null,
): Workout {
  return mapBlock(workout, blockId, (block) => ({
    ...block,
    rounds: override(block.rounds, rounds),
  }));
}

export function setBlockRestBetweenRounds(
  workout: Workout,
  blockId: string,
  seconds: number | null,
): Workout {
  return mapBlock(workout, blockId, (block) => ({
    ...block,
    restBetweenRoundsSeconds: override(block.restBetweenRoundsSeconds, seconds),
  }));
}

/* -------------------------------- manual entry ------------------------------ */

/** The "Enter Workout Manually" path (PRD §19, §31) and the empty-workout starting point. */
export function createEmptyWorkout(title = 'My Workout'): Workout {
  const timestamp = new Date().toISOString();
  return {
    id: createId('wk'),
    title,
    source: { platform: 'other' },
    structure: 'straight_sets',
    blocks: [
      {
        id: createId('blk'),
        kind: 'straight_sets',
        exercises: [],
        order: 0,
      },
    ],
    workoutNotes: [],
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}
