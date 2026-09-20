import { createId } from '../util/id';
import type {
  ExecutionPlan,
  SessionStatus,
  Step,
  StepProgress,
  TimerState,
  WorkoutSession,
} from '../schema/session';
import type { Workout } from '../schema/workout';

/**
 * The execution state machine.
 *
 * A plain reducer over a serializable state object. Pure, so the PRD §41 acceptance
 * scenario is a test file rather than a manual QA script, and so the same engine can
 * later drive a watch app or a web player without modification.
 */

export type SessionEvent =
  | { type: 'START'; now: number }
  | { type: 'COMPLETE_STEP'; now: number }
  | { type: 'SKIP_STEP'; now: number }
  | { type: 'PREVIOUS'; now: number }
  | { type: 'START_TIMER'; now: number }
  | { type: 'PAUSE'; now: number }
  | { type: 'RESUME'; now: number }
  | { type: 'ADD_TIME'; seconds: number; now: number }
  | { type: 'TICK'; now: number }
  | { type: 'ABANDON'; now: number };

export function createSession(
  workout: Workout,
  plan: ExecutionPlan,
  now: number,
): WorkoutSession {
  const session: WorkoutSession = {
    id: createId('ses'),
    workoutId: workout.id,
    workoutTitle: workout.title,
    status: 'not_started',
    currentStepIndex: 0,
    progress: {},
    timer: initialTimerFor(plan.steps[0]),
    startedAt: now,
  };
  if (workout.source.creatorHandle) session.creatorHandle = workout.source.creatorHandle;
  return session;
}

export function sessionReducer(
  state: WorkoutSession,
  plan: ExecutionPlan,
  event: SessionEvent,
): WorkoutSession {
  if (state.status === 'completed' || state.status === 'abandoned') return state;

  switch (event.type) {
    case 'START': {
      if (state.status === 'active') return state;
      if (plan.steps.length === 0) {
        return { ...state, status: 'completed', endedAt: event.now };
      }
      return {
        ...state,
        status: 'active',
        startedAt: event.now,
        progress: markStarted(state.progress, plan.steps[0], event.now),
        timer: initialTimerFor(plan.steps[0]),
      };
    }

    case 'COMPLETE_STEP':
      return advance(state, plan, event.now, 'completed');

    case 'SKIP_STEP':
      return advance(state, plan, event.now, 'skipped');

    case 'PREVIOUS': {
      if (state.currentStepIndex === 0) return state;
      const targetIndex = state.currentStepIndex - 1;
      const target = plan.steps[targetIndex];
      if (!target) return state;

      // Re-entering a step clears its outcome: you are doing it again, so it is
      // no longer completed or skipped.
      const progress = { ...state.progress };
      delete progress[target.id];
      delete progress[plan.steps[state.currentStepIndex]?.id ?? ''];

      return {
        ...state,
        status: 'active',
        currentStepIndex: targetIndex,
        progress: markStarted(progress, target, event.now),
        timer: initialTimerFor(target),
      };
    }

    case 'START_TIMER': {
      const timer = state.timer;
      if (!timer || timer.mode === 'running') return state;
      const remainingMs =
        timer.mode === 'paused' ? timer.remainingMs : timer.durationSeconds * 1000;
      return {
        ...state,
        status: 'active',
        timer: { mode: 'running', durationSeconds: timer.durationSeconds, endsAt: event.now + remainingMs },
      };
    }

    case 'PAUSE': {
      const timer = state.timer;
      if (!timer || timer.mode !== 'running') return state;
      return {
        ...state,
        timer: {
          mode: 'paused',
          durationSeconds: timer.durationSeconds,
          remainingMs: Math.max(0, timer.endsAt - event.now),
        },
      };
    }

    case 'RESUME': {
      const timer = state.timer;
      if (!timer || timer.mode !== 'paused') return state;
      return {
        ...state,
        timer: {
          mode: 'running',
          durationSeconds: timer.durationSeconds,
          endsAt: event.now + timer.remainingMs,
        },
      };
    }

    case 'ADD_TIME': {
      const timer = state.timer;
      if (!timer) return state;
      const deltaMs = event.seconds * 1000;
      const durationSeconds = timer.durationSeconds + event.seconds;
      if (timer.mode === 'running') {
        return { ...state, timer: { ...timer, durationSeconds, endsAt: timer.endsAt + deltaMs } };
      }
      if (timer.mode === 'paused') {
        return {
          ...state,
          timer: { ...timer, durationSeconds, remainingMs: Math.max(0, timer.remainingMs + deltaMs) },
        };
      }
      return { ...state, timer: { ...timer, durationSeconds } };
    }

    case 'TICK': {
      const timer = state.timer;
      if (!timer || timer.mode !== 'running') return state;
      if (event.now < timer.endsAt) return state;
      // A timer reaching zero completes its step and moves on — no tap required
      // for rest or for timed work (PRD §12, §13).
      return advance(state, plan, event.now, 'completed');
    }

    case 'ABANDON':
      return { ...state, status: 'abandoned', endedAt: event.now, timer: null };

    default:
      return state;
  }
}

function advance(
  state: WorkoutSession,
  plan: ExecutionPlan,
  now: number,
  outcome: 'completed' | 'skipped',
): WorkoutSession {
  const current = plan.steps[state.currentStepIndex];
  if (!current) return { ...state, status: 'completed', endedAt: now, timer: null };

  const startedAt = state.progress[current.id]?.startedAt ?? now;
  const progress: Record<string, StepProgress> = {
    ...state.progress,
    [current.id]: {
      outcome,
      startedAt,
      completedAt: now,
      elapsedSeconds: Math.max(0, Math.round((now - startedAt) / 1000)),
    },
  };

  const nextIndex = state.currentStepIndex + 1;
  const next = plan.steps[nextIndex];

  if (!next) {
    return {
      ...state,
      status: 'completed' satisfies SessionStatus,
      currentStepIndex: state.currentStepIndex,
      progress,
      timer: null,
      endedAt: now,
    };
  }

  return {
    ...state,
    status: 'active',
    currentStepIndex: nextIndex,
    progress: markStarted(progress, next, now),
    timer: initialTimerFor(next),
  };
}

function markStarted(
  progress: Record<string, StepProgress>,
  step: Step | undefined,
  now: number,
): Record<string, StepProgress> {
  if (!step) return progress;
  const existing = progress[step.id];
  if (existing?.outcome === 'completed' || existing?.outcome === 'skipped') return progress;
  return { ...progress, [step.id]: { outcome: 'pending', startedAt: now } };
}

/**
 * Rest runs itself the moment you arrive; timed work waits for START.
 *
 * That asymmetry is deliberate and comes straight from the PRD: rest begins
 * automatically after a set (§12), while a timed exercise gives the user a START
 * button so they can get into position first (§13).
 */
function initialTimerFor(step: Step | undefined): TimerState | null {
  if (!step) return null;
  if (step.kind === 'rest') {
    return { mode: 'idle', durationSeconds: step.durationSeconds };
  }
  if (step.durationSeconds != null) {
    return { mode: 'idle', durationSeconds: step.durationSeconds };
  }
  return null;
}

/** Rest auto-starts on arrival. Called by the player when a rest step becomes current. */
export function autoStartIfRest(
  state: WorkoutSession,
  plan: ExecutionPlan,
  now: number,
): WorkoutSession {
  const current = plan.steps[state.currentStepIndex];
  if (!current || current.kind !== 'rest') return state;
  if (state.timer?.mode !== 'idle') return state;
  return sessionReducer(state, plan, { type: 'START_TIMER', now });
}
