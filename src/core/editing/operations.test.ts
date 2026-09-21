import { describe, expect, it } from 'vitest';
import {
  addExercise,
  createEmptyWorkout,
  deleteExercise,
  moveExercise,
  setBlockRounds,
  setDurationSeconds,
  setReps,
  setRepsPerSide,
  setSets,
  setTitle,
} from './operations';
import { normalizeExtraction } from '../extraction/normalize';
import { LEG_DAY_CIRCUIT } from '../extraction/fixtures';
import { allExercises } from '../schema/workout';
import { compilePlan } from '../engine/plan';

function legDay() {
  return normalizeExtraction(LEG_DAY_CIRCUIT, { platform: 'tiktok' }).workout;
}

describe('editing operations', () => {
  it('overrides an extracted value and marks it as the user\'s', () => {
    const workout = legDay();
    const rdl = allExercises(workout)[1]!;
    const edited = setReps(workout, rdl.id, 15);

    const updated = allExercises(edited)[1]!;
    expect(updated.reps?.value).toBe(15);
    expect(updated.reps?.source).toBe('user');
    expect(updated.reps?.supersedes?.value).toBe(12);
  });

  it('keeps the three prescription modes mutually exclusive', () => {
    // Otherwise a stale reps value would silently outrank a newly set duration.
    const workout = legDay();
    const split = allExercises(workout)[0]!;
    expect(split.repsPerSide?.value).toBe(10);

    const timed = setDurationSeconds(workout, split.id, 30);
    const updated = allExercises(timed)[0]!;
    expect(updated.durationSeconds?.value).toBe(30);
    expect(updated.repsPerSide?.value).toBeNull();
    expect(updated.reps?.value).toBeNull();

    // And the change reaches execution: it is now a timed step.
    const step = compilePlan(timed).steps[0]!;
    expect(step.kind === 'exercise_set' && step.requiresManualCompletion).toBe(false);
  });

  it('fills in a value the creator never specified', () => {
    // PRD §8: users manually provide what was missing.
    const workout = legDay();
    const split = allExercises(workout)[0]!;
    expect(split.sets?.value ?? null).toBeNull();

    const edited = setSets(workout, split.id, 4);
    const updated = allExercises(edited)[0]!;
    expect(updated.sets?.value).toBe(4);
    expect(updated.sets?.supersedes).toBeUndefined();
  });

  it('adds, deletes and reorders exercises, keeping order contiguous', () => {
    const workout = legDay();
    const blockId = workout.blocks[0]!.id;

    const { workout: added } = addExercise(workout, blockId, 'Calf Raise');
    expect(allExercises(added).map((e) => e.name.value)).toEqual([
      'Bulgarian Split Squat',
      'Romanian Deadlift',
      'Wall Sit',
      'Calf Raise',
    ]);

    const moved = moveExercise(added, allExercises(added)[3]!.id, 'up');
    expect(allExercises(moved).map((e) => e.name.value)).toEqual([
      'Bulgarian Split Squat',
      'Romanian Deadlift',
      'Calf Raise',
      'Wall Sit',
    ]);

    const removed = deleteExercise(moved, allExercises(moved)[0]!.id);
    const remaining = allExercises(removed);
    expect(remaining).toHaveLength(3);
    expect(remaining.map((e) => e.order)).toEqual([0, 1, 2]);
  });

  it('leaves the workout untouched when a move would run off the end', () => {
    const workout = legDay();
    const first = allExercises(workout)[0]!;
    expect(allExercises(moveExercise(workout, first.id, 'up')).map((e) => e.id)).toEqual(
      allExercises(workout).map((e) => e.id),
    );
  });

  it('changes the number of rounds, and the plan follows', () => {
    const workout = legDay();
    const edited = setBlockRounds(workout, workout.blocks[0]!.id, 2);

    const plan = compilePlan(edited);
    // 2 rounds × 3 exercises + 1 round rest.
    expect(plan.steps).toHaveLength(7);
    expect(plan.steps.filter((s) => s.kind === 'rest')).toHaveLength(1);
  });

  it('renames a workout', () => {
    expect(setTitle(legDay(), 'Heavy Leg Day').title).toBe('Heavy Leg Day');
  });

  it('starts a manual workout from nothing', () => {
    // The "Enter Workout Manually" fallback (PRD §19, §31).
    const empty = createEmptyWorkout('Garage Session');
    expect(allExercises(empty)).toHaveLength(0);

    const { workout } = addExercise(empty, empty.blocks[0]!.id, 'Kettlebell Swing');
    const withReps = setRepsPerSide(workout, allExercises(workout)[0]!.id, 12);

    const step = compilePlan(withReps).steps[0]!;
    expect(step.kind === 'exercise_set' && step.exerciseName).toBe('Kettlebell Swing');
    expect(step.kind === 'exercise_set' && step.repsPerSide).toBe(12);
  });

  it('never mutates the workout it was given', () => {
    const workout = legDay();
    const snapshot = JSON.stringify(workout);
    setReps(workout, allExercises(workout)[1]!.id, 99);
    expect(JSON.stringify(workout)).toBe(snapshot);
  });
});
