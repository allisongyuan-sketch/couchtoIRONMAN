import { describe, expect, it } from 'vitest';
import { importWorkout } from './import/importWorkout';
import { MockExtractionService } from './extraction/mockService';
import { compilePlan } from './engine/plan';
import { createSession, sessionReducer } from './engine/session';
import { currentStep, remainingSeconds, summarize } from './engine/selectors';
import { setName, setRepsPerSide } from './editing/operations';
import { allExercises, prescriptionSummary } from './schema/workout';
import type { ExecutionPlan, WorkoutSession } from './schema/session';

/**
 * PRD §41 — THE REQUIRED ACCEPTANCE TEST.
 *
 * Source: "Do three rounds. Ten Bulgarian split squats each side, 12 RDLs, and a
 *          45-second wall sit. Rest for one minute after each round. Keep your torso
 *          slightly forward on the split squats."
 *
 * This file is the executable version of that section. It runs the real import
 * orchestrator, the real guardrails, the real compiler and the real state machine —
 * only the model itself is mocked.
 */

const T0 = 1_700_000_000_000;

async function importLegDay() {
  const outcome = await importWorkout(
    { url: 'https://www.tiktok.com/@coachlena/video/7311122334455' },
    {
      extractionService: new MockExtractionService({ forceFixture: 'legDayCircuit' }),
      now: new Date(T0),
    },
  );
  if (outcome.status !== 'ok') throw new Error(`import failed: ${outcome.failure.message}`);
  return outcome;
}

describe('PRD §41 acceptance: three-round leg day circuit', () => {
  it('produces the prescribed structure and nothing more', async () => {
    const { workout } = await importLegDay();

    expect(workout.title).toBe('20-Minute Leg Day');
    expect(workout.structure).toBe('circuit');
    expect(workout.source.platform).toBe('tiktok');
    expect(workout.source.creatorHandle).toBe('@coachlena');

    // ONE circuit block of three exercises, repeated three times — not three
    // unrelated exercises that each claim "3 sets" (PRD §22).
    expect(workout.blocks).toHaveLength(1);
    const block = workout.blocks[0]!;
    expect(block.kind).toBe('circuit');
    expect(block.rounds?.value).toBe(3);
    expect(block.restBetweenRoundsSeconds?.value).toBe(60);

    const exercises = allExercises(workout);
    expect(exercises.map((e) => e.name.value)).toEqual([
      'Bulgarian Split Squat',
      'Romanian Deadlift',
      'Wall Sit',
    ]);

    const [split, rdl, wallSit] = exercises as [
      (typeof exercises)[number],
      (typeof exercises)[number],
      (typeof exercises)[number],
    ];

    expect(split.repsPerSide?.value).toBe(10);
    expect(prescriptionSummary(split)).toBe('10 reps / side');
    expect(split.formCues.map((cue) => cue.value)).toEqual([
      'Keep your torso slightly forward.',
    ]);

    expect(rdl.reps?.value).toBe(12);
    expect(wallSit.durationSeconds?.value).toBe(45);
  });

  it('invents no prescription the creator never gave', async () => {
    const { workout, extraction } = await importLegDay();
    const exercises = allExercises(workout);

    // The creator stated reps and round rest. They never stated sets, weight,
    // resistance, or per-exercise rest — so those must be absent, not defaulted.
    for (const exercise of exercises) {
      expect(exercise.sets?.value ?? null).toBeNull();
      expect(exercise.weight?.value ?? null).toBeNull();
      expect(exercise.resistance?.value ?? null).toBeNull();
      expect(exercise.restSeconds?.value ?? null).toBeNull();
    }

    // No AI-authored coaching. The only cue present is the one the creator spoke.
    const allCues = exercises.flatMap((exercise) => exercise.formCues);
    expect(allCues).toHaveLength(1);
    expect(allCues[0]!.source).toBe('speech');

    // And the extraction record proves the guardrail pass had nothing to strip.
    expect(extraction.guardrailActions.filter((a) => a.action === 'stripped')).toHaveLength(0);
  });

  it('compiles to 3 rounds of 3 exercises with a 60s rest after rounds 1 and 2', async () => {
    const { workout } = await importLegDay();
    const plan = compilePlan(workout);

    // 9 work steps + 2 round rests. NOT 3 rests: the workout ends on work, never on
    // a timer counting down to nothing (PRD §41 — "After Round 3: Workout Complete").
    expect(plan.steps).toHaveLength(11);

    const shape = plan.steps.map((step) =>
      step.kind === 'rest'
        ? `rest:${step.durationSeconds}:${step.reason}`
        : `${step.exerciseName} (r${step.roundNumber})`,
    );

    expect(shape).toEqual([
      'Bulgarian Split Squat (r1)',
      'Romanian Deadlift (r1)',
      'Wall Sit (r1)',
      'rest:60:between_rounds',
      'Bulgarian Split Squat (r2)',
      'Romanian Deadlift (r2)',
      'Wall Sit (r2)',
      'rest:60:between_rounds',
      'Bulgarian Split Squat (r3)',
      'Romanian Deadlift (r3)',
      'Wall Sit (r3)',
    ]);
  });

  it('requires a manual tap for reps and runs a timer for the wall sit', async () => {
    const { workout } = await importLegDay();
    const plan = compilePlan(workout);

    const split = plan.steps[0]!;
    const rdl = plan.steps[1]!;
    const wallSit = plan.steps[2]!;

    // Rep-based work waits for COMPLETE SET — no camera rep counting in MVP (§14).
    expect(split.kind === 'exercise_set' && split.requiresManualCompletion).toBe(true);
    expect(rdl.kind === 'exercise_set' && rdl.requiresManualCompletion).toBe(true);

    // The 45-second wall sit gets its timer automatically (§13).
    expect(wallSit.kind === 'exercise_set' && wallSit.requiresManualCompletion).toBe(false);
    expect(wallSit.kind === 'exercise_set' && wallSit.durationSeconds).toBe(45);
  });

  it('executes all three rounds and completes', async () => {
    const { workout } = await importLegDay();
    const plan = compilePlan(workout);
    let session = createSession(workout, plan, T0);
    let clock = T0;

    session = sessionReducer(session, plan, { type: 'START', now: clock });
    expect(session.status).toBe('active');

    for (let round = 1; round <= 3; round += 1) {
      // Bulgarian split squat — manual completion.
      expect(asExercise(plan, session).exerciseName).toBe('Bulgarian Split Squat');
      expect(asExercise(plan, session).roundNumber).toBe(round);
      clock += 40_000;
      session = sessionReducer(session, plan, { type: 'COMPLETE_STEP', now: clock });

      // Romanian deadlift — manual completion.
      expect(asExercise(plan, session).exerciseName).toBe('Romanian Deadlift');
      clock += 35_000;
      session = sessionReducer(session, plan, { type: 'COMPLETE_STEP', now: clock });

      // Wall sit — a 45s timer that runs itself to zero.
      expect(asExercise(plan, session).exerciseName).toBe('Wall Sit');
      expect(session.timer).toEqual({ mode: 'idle', durationSeconds: 45 });
      session = sessionReducer(session, plan, { type: 'START_TIMER', now: clock });
      expect(remainingSeconds(session, clock)).toBe(45);
      clock += 45_000;
      session = sessionReducer(session, plan, { type: 'TICK', now: clock });

      if (round < 3) {
        // A 60-second rest appears after the round (PRD §41).
        const rest = currentStep(plan, session);
        expect(rest?.kind).toBe('rest');
        expect(rest?.kind === 'rest' && rest.durationSeconds).toBe(60);

        session = sessionReducer(session, plan, { type: 'START_TIMER', now: clock });
        clock += 60_000;
        session = sessionReducer(session, plan, { type: 'TICK', now: clock });
      }
    }

    // After Round 3: Workout Complete.
    expect(session.status).toBe('completed');

    const summary = summarize(plan, session, clock);
    expect(summary.exercisesCompleted).toBe(3);
    expect(summary.exercisesTotal).toBe(3);
    expect(summary.workoutTitle).toBe('20-Minute Leg Day');
    expect(summary.creatorHandle).toBe('@coachlena');
  });

  it('lets the user modify extracted values, and executes the edited version', async () => {
    const { workout } = await importLegDay();
    const splitSquat = allExercises(workout)[0]!;

    // "The user can modify any extracted sets/reps." (PRD §41, §7)
    let edited = setRepsPerSide(workout, splitSquat.id, 8);
    edited = setName(edited, splitSquat.id, 'Rear-Foot-Elevated Split Squat');

    const updated = allExercises(edited)[0]!;
    expect(updated.repsPerSide?.value).toBe(8);
    expect(updated.repsPerSide?.source).toBe('user');
    // The creator's original value survives the override (PRD §3.3).
    expect(updated.repsPerSide?.supersedes?.value).toBe(10);

    const plan = compilePlan(edited);
    const first = plan.steps[0]!;
    expect(first.kind === 'exercise_set' && first.repsPerSide).toBe(8);
    expect(first.kind === 'exercise_set' && first.exerciseName).toBe(
      'Rear-Foot-Elevated Split Squat',
    );
  });
});

function asExercise(plan: ExecutionPlan, session: WorkoutSession) {
  const step = currentStep(plan, session);
  if (!step || step.kind !== 'exercise_set') {
    throw new Error(`expected an exercise step, got ${step?.kind ?? 'nothing'}`);
  }
  return step;
}
