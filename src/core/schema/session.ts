import { z } from 'zod';
import { blockKindSchema, type BlockKind } from './workout';

/* ================================================================== *
 * Execution plan
 *
 * The compiler flattens the block tree into an ordered, immutable list of steps
 * BEFORE the workout begins. Computing "what's next" ahead of time rather than on
 * the fly is what makes progress, Previous, seeking and resume-after-kill trivially
 * correct — the player reads an array, it does not reason about circuits.
 *
 * Each step is denormalized (carries its own exercise name, "set 2 of 3", cues) so
 * nothing has to be re-derived mid-workout with sweaty hands on screen.
 * ================================================================== */

export const REST_REASONS = ['between_sets', 'between_exercises', 'between_rounds'] as const;
export type RestReason = (typeof REST_REASONS)[number];

const baseStepShape = {
  id: z.string(),
  index: z.number().int().min(0),
  blockId: z.string(),
  blockKind: blockKindSchema,
  /** 1-based round within the block. A circuit's "ROUND 2 OF 3". */
  roundNumber: z.number().int().min(1),
  totalRounds: z.number().int().min(1),
};

export const exerciseSetStepSchema = z.object({
  ...baseStepShape,
  kind: z.literal('exercise_set'),
  workoutExerciseId: z.string(),
  exerciseId: z.string(),
  exerciseName: z.string(),
  /** 1-based set within this exercise, within this round. "SET 1 OF 3". */
  setNumber: z.number().int().min(1),
  totalSets: z.number().int().min(1),
  reps: z.number().nullable(),
  repsPerSide: z.number().nullable(),
  durationSeconds: z.number().nullable(),
  weight: z.string().nullable(),
  formCues: z.array(z.string()),
  /**
   * Rep-based work needs a human tap (PRD §14 — no camera rep counting in MVP).
   * Wearable/vision rep detection later means flipping this flag, not rewriting
   * the player.
   */
  requiresManualCompletion: z.boolean(),
  /** False when the creator gave no prescription — the UI shows "Not specified". */
  prescriptionSpecified: z.boolean(),
});
export type ExerciseSetStep = z.infer<typeof exerciseSetStepSchema>;

export const restStepSchema = z.object({
  ...baseStepShape,
  kind: z.literal('rest'),
  durationSeconds: z.number().min(0),
  reason: z.enum(REST_REASONS),
});
export type RestStep = z.infer<typeof restStepSchema>;

export const stepSchema = z.discriminatedUnion('kind', [exerciseSetStepSchema, restStepSchema]);
export type Step = ExerciseSetStep | RestStep;

export const executionPlanSchema = z.object({
  workoutId: z.string(),
  steps: z.array(stepSchema),
  /** Sum of known timed work + known rest. Unknown-duration steps contribute 0. */
  estimatedSeconds: z.number().min(0),
});
export type ExecutionPlan = z.infer<typeof executionPlanSchema>;

export function isExerciseStep(step: Step): step is ExerciseSetStep {
  return step.kind === 'exercise_set';
}
export function isRestStep(step: Step): step is RestStep {
  return step.kind === 'rest';
}

/** A step that runs on a clock: timed exercise work, or rest. */
export function stepDurationSeconds(step: Step): number | null {
  return step.kind === 'rest' ? step.durationSeconds : step.durationSeconds;
}

export function isTimedStep(step: Step): boolean {
  return stepDurationSeconds(step) !== null;
}

export type { BlockKind };

/* ================================================================== *
 * Session state
 *
 * A plain serializable object. Snapshotted on every event, so killing the app
 * mid-workout loses nothing (PRD §23).
 * ================================================================== */

export const STEP_OUTCOMES = ['pending', 'completed', 'skipped'] as const;
export type StepOutcome = (typeof STEP_OUTCOMES)[number];

export const stepProgressSchema = z.object({
  outcome: z.enum(STEP_OUTCOMES),
  startedAt: z.number().optional(),
  completedAt: z.number().optional(),
  /** Actual seconds spent. Diverges from prescribed when the user skips or adds time. */
  elapsedSeconds: z.number().optional(),
});
export type StepProgress = z.infer<typeof stepProgressSchema>;

/**
 * Timers are DEADLINES, not tick counters.
 *
 * Storing `endsAt` and deriving remaining time from the wall clock means that
 * backgrounding the app, locking the phone, or a dropped interval cannot
 * desynchronize a rest timer. The UI ticks only to re-render.
 */
export const timerStateSchema = z.discriminatedUnion('mode', [
  z.object({ mode: z.literal('idle'), durationSeconds: z.number().min(0) }),
  z.object({
    mode: z.literal('running'),
    durationSeconds: z.number().min(0),
    endsAt: z.number(),
  }),
  z.object({
    mode: z.literal('paused'),
    durationSeconds: z.number().min(0),
    remainingMs: z.number().min(0),
  }),
]);
export type TimerState = z.infer<typeof timerStateSchema>;

export const SESSION_STATUSES = ['not_started', 'active', 'completed', 'abandoned'] as const;
export type SessionStatus = (typeof SESSION_STATUSES)[number];

export const workoutSessionSchema = z.object({
  id: z.string(),
  workoutId: z.string(),
  workoutTitle: z.string(),
  creatorHandle: z.string().optional(),
  status: z.enum(SESSION_STATUSES),
  currentStepIndex: z.number().int().min(0),
  /** Keyed by step id, so a plan recompile cannot silently shift progress. */
  progress: z.record(z.string(), stepProgressSchema),
  timer: timerStateSchema.nullable(),
  startedAt: z.number(),
  endedAt: z.number().optional(),
});
export type WorkoutSession = z.infer<typeof workoutSessionSchema>;

/** A finished session, as the History screen reads it (PRD §17). */
export interface SessionSummary {
  sessionId: string;
  workoutId: string;
  workoutTitle: string;
  creatorHandle?: string;
  completedAt: number;
  durationSeconds: number;
  exercisesCompleted: number;
  exercisesTotal: number;
}
