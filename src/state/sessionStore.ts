import { create } from 'zustand';
import { compilePlan } from '@/core/engine/plan';
import {
  createSession,
  sessionReducer,
  type SessionEvent,
} from '@/core/engine/session';
import {
  completedExerciseIds,
  currentStep,
  progressRatio,
  summarize,
  totalExerciseIds,
} from '@/core/engine/selectors';
import type { ExecutionPlan, SessionSummary, Step, WorkoutSession } from '@/core/schema/session';
import type { Workout } from '@/core/schema/workout';
import { track } from '@/core/analytics';
import { repositories } from './container';
import { useHistoryStore } from './historyStore';
import { useLibraryStore } from './libraryStore';

/**
 * The live workout.
 *
 * This store is a thin shell: all the decisions live in the pure reducer, and every
 * dispatch is persisted so that closing the app mid-workout loses nothing (PRD §23).
 */
interface SessionState {
  workout: Workout | null;
  plan: ExecutionPlan | null;
  session: WorkoutSession | null;
  summary: SessionSummary | null;

  begin: (workout: Workout) => void;
  dispatch: (event: SessionEvent) => void;
  /** Called by the player's ticker. Cheap and idempotent when no timer is running. */
  tick: (now?: number) => void;
  restore: () => Promise<boolean>;
  abandon: () => void;
  clear: () => void;

  currentStep: () => Step | undefined;
  progress: () => number;
}

export const useSessionStore = create<SessionState>((set, get) => ({
  workout: null,
  plan: null,
  session: null,
  summary: null,

  begin(workout) {
    const plan = compilePlan(workout);
    const now = Date.now();
    const session = sessionReducer(createSession(workout, plan, now), plan, {
      type: 'START',
      now,
    });

    set({ workout, plan, session, summary: null });
    void repositories.sessions.saveActive(session);
    track({ name: 'workout_started', workoutId: workout.id, stepCount: plan.steps.length });
  },

  dispatch(event) {
    const { plan, session, workout } = get();
    if (!plan || !session || !workout) return;

    const next = sessionReducer(session, plan, event);
    if (next === session) return;

    set({ session: next });

    if (next.status === 'completed' || next.status === 'abandoned') {
      void finish(next, plan, workout, set);
      return;
    }

    void repositories.sessions.saveActive(next);
  },

  tick(now = Date.now()) {
    const { session } = get();
    if (session?.timer?.mode !== 'running') return;
    get().dispatch({ type: 'TICK', now });
  },

  /** Resume an interrupted workout on launch. */
  async restore() {
    const session = await repositories.sessions.getActive();
    if (!session) return false;

    const workout = await repositories.workouts.get(session.workoutId);
    if (!workout) {
      await repositories.sessions.clearActive();
      return false;
    }

    set({ workout, plan: compilePlan(workout), session, summary: null });
    return true;
  },

  abandon() {
    get().dispatch({ type: 'ABANDON', now: Date.now() });
  },

  clear() {
    set({ workout: null, plan: null, session: null, summary: null });
    void repositories.sessions.clearActive();
  },

  currentStep() {
    const { plan, session } = get();
    return plan && session ? currentStep(plan, session) : undefined;
  },

  progress() {
    const { plan, session } = get();
    return plan && session ? progressRatio(plan, session) : 0;
  },
}));

async function finish(
  session: WorkoutSession,
  plan: ExecutionPlan,
  workout: Workout,
  set: (partial: Partial<SessionState>) => void,
): Promise<void> {
  const now = Date.now();
  const summary = summarize(plan, session, now);

  await repositories.sessions.clearActive();

  if (session.status === 'completed') {
    await repositories.sessions.appendHistory(summary);
    // Surfaces as "last performed" in the library (PRD §16).
    await repositories.workouts.save({
      ...workout,
      lastPerformedAt: new Date(now).toISOString(),
      updatedAt: new Date(now).toISOString(),
    });

    track({
      name: 'workout_completed',
      workoutId: workout.id,
      durationSeconds: summary.durationSeconds,
      exercisesCompleted: completedExerciseIds(plan, session).size,
      exercisesTotal: totalExerciseIds(plan).size,
    });

    void useHistoryStore.getState().load();
    void useLibraryStore.getState().load();
  } else {
    track({
      name: 'workout_abandoned',
      workoutId: workout.id,
      progressRatio: progressRatio(plan, session),
    });
  }

  set({ summary });
}
