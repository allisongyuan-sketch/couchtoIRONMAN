import { describe, expect, it } from 'vitest';
import { compilePlan } from './plan';
import { createSession, sessionReducer } from './session';
import { currentStep, progressRatio, remainingSeconds, summarize } from './selectors';
import { normalizeExtraction } from '../extraction/normalize';
import { LEG_DAY_CIRCUIT, UPPER_BODY_STRAIGHT_SETS } from '../extraction/fixtures';
import type { ExecutionPlan, WorkoutSession } from '../schema/session';

const T0 = 1_700_000_000_000;

function setup(raw = LEG_DAY_CIRCUIT) {
  const { workout } = normalizeExtraction(raw, { platform: 'tiktok', creatorHandle: '@coach' });
  const plan = compilePlan(workout);
  const session = sessionReducer(createSession(workout, plan, T0), plan, {
    type: 'START',
    now: T0,
  });
  return { workout, plan, session };
}

function step(plan: ExecutionPlan, session: WorkoutSession, event: Parameters<typeof sessionReducer>[2]) {
  return sessionReducer(session, plan, event);
}

describe('session state machine', () => {
  it('starts on the first step with a timer only where one is prescribed', () => {
    const { plan, session } = setup();
    expect(session.status).toBe('active');
    expect(session.currentStepIndex).toBe(0);
    // Bulgarian split squat is rep-based: no timer at all.
    expect(session.timer).toBeNull();
    expect(currentStep(plan, session)?.kind).toBe('exercise_set');
  });

  it('advances on COMPLETE_STEP and records elapsed time', () => {
    const { plan, session } = setup();
    const first = plan.steps[0]!;
    const after = step(plan, session, { type: 'COMPLETE_STEP', now: T0 + 42_000 });

    expect(after.currentStepIndex).toBe(1);
    expect(after.progress[first.id]?.outcome).toBe('completed');
    expect(after.progress[first.id]?.elapsedSeconds).toBe(42);
  });

  it('records a skipped step distinctly from a completed one', () => {
    const { plan, session } = setup();
    const first = plan.steps[0]!;
    const after = step(plan, session, { type: 'SKIP_STEP', now: T0 + 1_000 });

    expect(after.progress[first.id]?.outcome).toBe('skipped');
    // Skipped work does not count as an exercise you completed.
    expect(summarize(plan, after, T0 + 1_000).exercisesCompleted).toBe(0);
  });

  it('derives remaining time from the wall clock, not from ticks', () => {
    let { plan, session } = setup();
    // Advance to the wall sit.
    session = step(plan, session, { type: 'COMPLETE_STEP', now: T0 });
    session = step(plan, session, { type: 'COMPLETE_STEP', now: T0 });
    session = step(plan, session, { type: 'START_TIMER', now: T0 });

    // No TICK events at all — the app could have been backgrounded the whole time.
    expect(remainingSeconds(session, T0 + 20_000)).toBe(25);
    expect(remainingSeconds(session, T0 + 45_000)).toBe(0);
    // And past the deadline it clamps rather than going negative.
    expect(remainingSeconds(session, T0 + 90_000)).toBe(0);
  });

  it('auto-advances when a timer reaches zero', () => {
    let { plan, session } = setup();
    session = step(plan, session, { type: 'COMPLETE_STEP', now: T0 });
    session = step(plan, session, { type: 'COMPLETE_STEP', now: T0 });
    const wallSitIndex = session.currentStepIndex;

    session = step(plan, session, { type: 'START_TIMER', now: T0 });
    // A tick before the deadline changes nothing.
    session = step(plan, session, { type: 'TICK', now: T0 + 44_000 });
    expect(session.currentStepIndex).toBe(wallSitIndex);

    session = step(plan, session, { type: 'TICK', now: T0 + 45_000 });
    expect(session.currentStepIndex).toBe(wallSitIndex + 1);
    expect(currentStep(plan, session)?.kind).toBe('rest');
  });

  it('pauses and resumes without losing time', () => {
    let { plan, session } = setup();
    session = step(plan, session, { type: 'COMPLETE_STEP', now: T0 });
    session = step(plan, session, { type: 'COMPLETE_STEP', now: T0 });
    session = step(plan, session, { type: 'START_TIMER', now: T0 });

    session = step(plan, session, { type: 'PAUSE', now: T0 + 10_000 });
    expect(remainingSeconds(session, T0 + 10_000)).toBe(35);
    // While paused, the clock moving does not consume the timer.
    expect(remainingSeconds(session, T0 + 60_000)).toBe(35);

    session = step(plan, session, { type: 'RESUME', now: T0 + 60_000 });
    expect(remainingSeconds(session, T0 + 60_000)).toBe(35);
    expect(remainingSeconds(session, T0 + 80_000)).toBe(15);
  });

  it('adds time to a running timer (+30 sec)', () => {
    let { plan, session } = setup();
    session = step(plan, session, { type: 'COMPLETE_STEP', now: T0 });
    session = step(plan, session, { type: 'COMPLETE_STEP', now: T0 });
    session = step(plan, session, { type: 'START_TIMER', now: T0 });
    session = step(plan, session, { type: 'ADD_TIME', seconds: 15, now: T0 + 5_000 });

    expect(remainingSeconds(session, T0 + 5_000)).toBe(55);
    expect(session.timer?.durationSeconds).toBe(60);
  });

  it('adds time to an idle timer before it has been started', () => {
    let { plan, session } = setup();
    session = step(plan, session, { type: 'COMPLETE_STEP', now: T0 });
    session = step(plan, session, { type: 'COMPLETE_STEP', now: T0 });
    session = step(plan, session, { type: 'ADD_TIME', seconds: 15, now: T0 });

    expect(session.timer).toEqual({ mode: 'idle', durationSeconds: 60 });
  });

  it('goes back a step and clears that step\'s outcome', () => {
    const { plan, session } = setup();
    const first = plan.steps[0]!;
    let after = step(plan, session, { type: 'COMPLETE_STEP', now: T0 + 10_000 });
    after = step(plan, after, { type: 'PREVIOUS', now: T0 + 12_000 });

    expect(after.currentStepIndex).toBe(0);
    // You are doing it again, so it is no longer completed.
    expect(after.progress[first.id]?.outcome).toBe('pending');
  });

  it('will not go back past the first step', () => {
    const { plan, session } = setup();
    expect(step(plan, session, { type: 'PREVIOUS', now: T0 }).currentStepIndex).toBe(0);
  });

  it('completes after the final step and stops accepting events', () => {
    let { plan, session } = setup(UPPER_BODY_STRAIGHT_SETS);
    let clock = T0;

    while (session.status === 'active') {
      clock += 1_000;
      const current = currentStep(plan, session);
      if (current?.kind === 'rest' || (current?.kind === 'exercise_set' && current.durationSeconds)) {
        session = step(plan, session, { type: 'START_TIMER', now: clock });
        clock += (current.kind === 'rest' ? current.durationSeconds : current.durationSeconds ?? 0) * 1000;
        session = step(plan, session, { type: 'TICK', now: clock });
      } else {
        session = step(plan, session, { type: 'COMPLETE_STEP', now: clock });
      }
    }

    expect(session.status).toBe('completed');
    expect(session.endedAt).toBeDefined();
    expect(progressRatio(plan, session)).toBe(1);

    // A finished session is immutable — a late tap cannot reopen it.
    const frozen = step(plan, session, { type: 'COMPLETE_STEP', now: clock + 1_000 });
    expect(frozen).toBe(session);
  });

  it('abandons cleanly and keeps partial progress', () => {
    const { plan, session } = setup();
    let after = step(plan, session, { type: 'COMPLETE_STEP', now: T0 + 30_000 });
    after = step(plan, after, { type: 'ABANDON', now: T0 + 40_000 });

    expect(after.status).toBe('abandoned');
    expect(after.timer).toBeNull();
    expect(summarize(plan, after, T0 + 40_000).exercisesCompleted).toBe(1);
  });

  it('survives serialization, so an interrupted workout can be resumed', () => {
    const { plan, session } = setup();
    const midway = step(plan, session, { type: 'COMPLETE_STEP', now: T0 + 30_000 });

    // This is what gets written to storage on every event (PRD §23).
    const restored: WorkoutSession = JSON.parse(JSON.stringify(midway));
    expect(restored).toEqual(midway);

    const resumed = step(plan, restored, { type: 'COMPLETE_STEP', now: T0 + 60_000 });
    expect(resumed.currentStepIndex).toBe(2);
  });
});
