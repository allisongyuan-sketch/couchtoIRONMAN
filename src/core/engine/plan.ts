import {
  blockRounds,
  exerciseSets,
  hasNoPrescription,
  type Workout,
  type WorkoutBlock,
  type WorkoutExercise,
} from '../schema/workout';
import type { ExecutionPlan, ExerciseSetStep, RestStep, Step } from '../schema/session';

/**
 * Compile a workout into a flat, ordered, immutable list of steps.
 *
 * Doing this ahead of time — rather than asking "what comes next?" mid-workout — is
 * what makes progress, Previous, resume-after-kill and completion trivially correct.
 * The player consumes an array; it never reasons about circuits.
 *
 * Two structural rules encode the difference the PRD cares about (§22, §41):
 *
 *   straight_sets  → repetition comes from each exercise's `sets`;
 *                    rest is taken after each set.
 *   everything else (circuit / superset / interval / amrap / emom / flow)
 *                  → repetition comes from the BLOCK's `rounds`; each exercise is
 *                    performed once per round, and rest is taken after the round.
 *
 * And one product rule: **rest steps are only emitted when the creator specified a
 * rest duration.** A workout with no stated rest simply has no rest steps. We do not
 * insert 60 seconds because that would be typical (PRD §3.1, §21).
 */
export function compilePlan(workout: Workout): ExecutionPlan {
  const steps: Step[] = [];
  const blocks = [...workout.blocks].sort((a, b) => a.order - b.order);

  for (const block of blocks) {
    const rounds = blockRounds(block);
    const exercises = [...block.exercises].sort((a, b) => a.order - b.order);
    const roundsDriveRepetition = block.kind !== 'straight_sets';

    for (let round = 1; round <= rounds; round += 1) {
      for (const exercise of exercises) {
        const setsToRun = roundsDriveRepetition ? 1 : exerciseSets(exercise);

        for (let setNumber = 1; setNumber <= setsToRun; setNumber += 1) {
          steps.push(
            buildExerciseStep({
              block,
              exercise,
              round,
              rounds,
              setNumber,
              totalSets: setsToRun,
              index: steps.length,
            }),
          );

          const restSeconds = exercise.restSeconds?.value;
          const isLastSetOfExercise = setNumber === setsToRun;

          // Per-exercise rest, only when stated.
          if (restSeconds != null && restSeconds > 0) {
            steps.push(
              buildRestStep({
                block,
                round,
                rounds,
                durationSeconds: restSeconds,
                reason: isLastSetOfExercise ? 'between_exercises' : 'between_sets',
                index: steps.length,
              }),
            );
          }
        }
      }

      // Round rest, only when stated, and never after the final round — the workout
      // ends on work, not on a timer counting down to nothing (PRD §41).
      const roundRest = block.restBetweenRoundsSeconds?.value;
      if (roundRest != null && roundRest > 0 && round < rounds) {
        steps.push(
          buildRestStep({
            block,
            round,
            rounds,
            durationSeconds: roundRest,
            reason: 'between_rounds',
            index: steps.length,
          }),
        );
      }
    }
  }

  const trimmed = trimTrailingRest(steps);
  return {
    workoutId: workout.id,
    steps: trimmed,
    estimatedSeconds: trimmed.reduce((total, step) => {
      const duration = step.kind === 'rest' ? step.durationSeconds : step.durationSeconds;
      return total + (duration ?? 0);
    }, 0),
  };
}

function buildExerciseStep(args: {
  block: WorkoutBlock;
  exercise: WorkoutExercise;
  round: number;
  rounds: number;
  setNumber: number;
  totalSets: number;
  index: number;
}): ExerciseSetStep {
  const { block, exercise, round, rounds, setNumber, totalSets, index } = args;
  const durationSeconds = exercise.durationSeconds?.value ?? null;

  return {
    id: `${block.id}:${exercise.id}:r${round}:s${setNumber}`,
    index,
    kind: 'exercise_set',
    blockId: block.id,
    blockKind: block.kind,
    roundNumber: round,
    totalRounds: rounds,
    workoutExerciseId: exercise.id,
    exerciseId: exercise.exerciseId,
    exerciseName: exercise.name.value ?? 'Unnamed movement',
    setNumber,
    totalSets,
    reps: exercise.reps?.value ?? null,
    repsPerSide: exercise.repsPerSide?.value ?? null,
    durationSeconds,
    weight: exercise.weight?.value ?? null,
    formCues: exercise.formCues.map((cue) => cue.value).filter((cue): cue is string => !!cue),
    // Timed work runs itself; everything else waits for a tap (PRD §14).
    requiresManualCompletion: durationSeconds === null,
    prescriptionSpecified: !hasNoPrescription(exercise),
  };
}

function buildRestStep(args: {
  block: WorkoutBlock;
  round: number;
  rounds: number;
  durationSeconds: number;
  reason: RestStep['reason'];
  index: number;
}): RestStep {
  const { block, round, rounds, durationSeconds, reason, index } = args;
  return {
    id: `${block.id}:rest:r${round}:${reason}:${index}`,
    index,
    kind: 'rest',
    blockId: block.id,
    blockKind: block.kind,
    roundNumber: round,
    totalRounds: rounds,
    durationSeconds,
    reason,
  };
}

/**
 * A workout must not end on a rest timer. If the last steps are rest, drop them and
 * reindex — finishing the last set IS finishing the workout.
 */
function trimTrailingRest(steps: Step[]): Step[] {
  let end = steps.length;
  while (end > 0 && steps[end - 1]?.kind === 'rest') end -= 1;
  return steps.slice(0, end).map((step, index) => ({ ...step, index }));
}
