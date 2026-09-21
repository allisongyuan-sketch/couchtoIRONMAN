import { describe, expect, it } from 'vitest';
import { compilePlan } from './plan';
import { normalizeExtraction } from '../extraction/normalize';
import {
  HIP_MOBILITY_FLOW,
  LEG_DAY_CIRCUIT,
  UPPER_BODY_STRAIGHT_SETS,
} from '../extraction/fixtures';
import type { Workout } from '../schema/workout';

function workoutFrom(raw: Parameters<typeof normalizeExtraction>[0]): Workout {
  return normalizeExtraction(raw, { platform: 'tiktok' }).workout;
}

describe('compilePlan', () => {
  it('drives straight sets from each exercise\'s own sets, resting between them', () => {
    const plan = compilePlan(workoutFrom(UPPER_BODY_STRAIGHT_SETS));

    // Bench: 4 sets + 4 rests. Press: 3 sets + 3 rests. The final rest is trimmed.
    const benchSteps = plan.steps.filter(
      (step) => step.kind === 'exercise_set' && step.exerciseName === 'Dumbbell Bench Press',
    );
    expect(benchSteps).toHaveLength(4);
    expect(benchSteps[0]!.kind === 'exercise_set' && benchSteps[0]!.setNumber).toBe(1);
    expect(benchSteps[0]!.kind === 'exercise_set' && benchSteps[0]!.totalSets).toBe(4);

    // 4 + 3 work steps, 4 + 3 rests, minus the trailing one.
    expect(plan.steps).toHaveLength(4 + 3 + 4 + 3 - 1);
    expect(plan.steps[plan.steps.length - 1]!.kind).toBe('exercise_set');
  });

  it('labels rest between sets and between exercises differently', () => {
    const plan = compilePlan(workoutFrom(UPPER_BODY_STRAIGHT_SETS));
    const rests = plan.steps.filter((step) => step.kind === 'rest');
    const reasons = rests.map((step) => (step.kind === 'rest' ? step.reason : ''));

    // Three rests inside the bench sets, then one moving on to the press.
    expect(reasons.slice(0, 4)).toEqual([
      'between_sets',
      'between_sets',
      'between_sets',
      'between_exercises',
    ]);
  });

  it('emits no rest at all when the creator never specified any', () => {
    // PRD §3.1: the system must not insert 60 seconds just because it is typical.
    const plan = compilePlan(workoutFrom(HIP_MOBILITY_FLOW));
    expect(plan.steps.filter((step) => step.kind === 'rest')).toHaveLength(0);
    expect(plan.steps).toHaveLength(4);
  });

  it('marks unprescribed exercises so the UI can say "Not specified"', () => {
    const plan = compilePlan(workoutFrom(HIP_MOBILITY_FLOW));
    for (const step of plan.steps) {
      expect(step.kind === 'exercise_set' && step.prescriptionSpecified).toBe(false);
      // With no duration, there is nothing to time — the user taps through.
      expect(step.kind === 'exercise_set' && step.requiresManualCompletion).toBe(true);
    }
  });

  it('never ends a workout on a rest timer', () => {
    for (const raw of [LEG_DAY_CIRCUIT, UPPER_BODY_STRAIGHT_SETS]) {
      const plan = compilePlan(workoutFrom(raw));
      expect(plan.steps[plan.steps.length - 1]!.kind).toBe('exercise_set');
    }
  });

  it('reindexes steps contiguously after trimming', () => {
    const plan = compilePlan(workoutFrom(UPPER_BODY_STRAIGHT_SETS));
    plan.steps.forEach((step, index) => expect(step.index).toBe(index));
  });

  it('estimates duration from known timed work and known rest only', () => {
    const plan = compilePlan(workoutFrom(LEG_DAY_CIRCUIT));
    // 3 wall sits × 45s + 2 round rests × 60s. Rep-based work contributes nothing,
    // because we genuinely do not know how long it takes.
    expect(plan.estimatedSeconds).toBe(3 * 45 + 2 * 60);
  });

  it('produces an empty plan for a workout with no exercises', () => {
    const workout = workoutFrom(HIP_MOBILITY_FLOW);
    const emptied: Workout = {
      ...workout,
      blocks: workout.blocks.map((block) => ({ ...block, exercises: [] })),
    };
    expect(compilePlan(emptied).steps).toHaveLength(0);
  });
});
