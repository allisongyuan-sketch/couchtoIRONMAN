import type {
  ExecutionPlan,
  SessionSummary,
  Step,
  WorkoutSession,
} from '../schema/session';

/** Read-only views over session state. Pure; safe to call on every render. */

export function currentStep(plan: ExecutionPlan, session: WorkoutSession): Step | undefined {
  return plan.steps[session.currentStepIndex];
}

export function nextStep(plan: ExecutionPlan, session: WorkoutSession): Step | undefined {
  return plan.steps[session.currentStepIndex + 1];
}

/** Milliseconds left on the clock, derived from wall time — never from a tick count. */
export function remainingMs(session: WorkoutSession, now: number): number {
  const timer = session.timer;
  if (!timer) return 0;
  if (timer.mode === 'running') return Math.max(0, timer.endsAt - now);
  if (timer.mode === 'paused') return timer.remainingMs;
  return timer.durationSeconds * 1000;
}

export function remainingSeconds(session: WorkoutSession, now: number): number {
  return Math.ceil(remainingMs(session, now) / 1000);
}

export function isTimerRunning(session: WorkoutSession): boolean {
  return session.timer?.mode === 'running';
}

/** 0–1 across the whole plan. Used for the progress bar in the player. */
export function progressRatio(plan: ExecutionPlan, session: WorkoutSession): number {
  if (plan.steps.length === 0) return 1;
  const settled = plan.steps.filter((step) => {
    const outcome = session.progress[step.id]?.outcome;
    return outcome === 'completed' || outcome === 'skipped';
  }).length;
  return Math.min(1, settled / plan.steps.length);
}

export function completedStepCount(plan: ExecutionPlan, session: WorkoutSession): number {
  return plan.steps.filter((step) => session.progress[step.id]?.outcome === 'completed').length;
}

/**
 * Distinct exercises the user actually completed at least one set of.
 * This is what History reports as "Completed 4/4 exercises" (PRD §17).
 */
export function completedExerciseIds(
  plan: ExecutionPlan,
  session: WorkoutSession,
): Set<string> {
  const ids = new Set<string>();
  for (const step of plan.steps) {
    if (step.kind !== 'exercise_set') continue;
    if (session.progress[step.id]?.outcome === 'completed') ids.add(step.workoutExerciseId);
  }
  return ids;
}

export function totalExerciseIds(plan: ExecutionPlan): Set<string> {
  const ids = new Set<string>();
  for (const step of plan.steps) {
    if (step.kind === 'exercise_set') ids.add(step.workoutExerciseId);
  }
  return ids;
}

export function summarize(
  plan: ExecutionPlan,
  session: WorkoutSession,
  now: number,
): SessionSummary {
  const endedAt = session.endedAt ?? now;
  const summary: SessionSummary = {
    sessionId: session.id,
    workoutId: session.workoutId,
    workoutTitle: session.workoutTitle,
    completedAt: endedAt,
    durationSeconds: Math.max(0, Math.round((endedAt - session.startedAt) / 1000)),
    exercisesCompleted: completedExerciseIds(plan, session).size,
    exercisesTotal: totalExerciseIds(plan).size,
  };
  if (session.creatorHandle) summary.creatorHandle = session.creatorHandle;
  return summary;
}

/** "ROUND 2 OF 3" — only meaningful for blocks whose repetition comes from rounds. */
export function roundLabel(step: Step | undefined): string | null {
  if (!step || step.totalRounds <= 1) return null;
  return `ROUND ${step.roundNumber} OF ${step.totalRounds}`;
}

/** "SET 1 OF 3" — only meaningful for straight sets. */
export function setLabel(step: Step | undefined): string | null {
  if (!step || step.kind !== 'exercise_set' || step.totalSets <= 1) return null;
  return `SET ${step.setNumber} OF ${step.totalSets}`;
}
