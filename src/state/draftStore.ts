import { create } from 'zustand';
import type { Workout } from '@/core/schema/workout';
import { allExercises } from '@/core/schema/workout';
import { fieldStatus, type ExtractedField } from '@/core/schema/provenance';
import { track } from '@/core/analytics';
import { repositories } from './container';
import { useLibraryStore } from './libraryStore';

/**
 * The workout currently being reviewed or edited.
 *
 * One store serves both the post-import review screen and editing an already-saved
 * workout, because they are the same operation: correct the structured workout, then
 * keep it. AI extraction will never be perfect (PRD §7), so editing is a primary
 * path rather than a recovery path.
 */
interface DraftState {
  workout: Workout | null;
  /** True when this draft has not been saved to the library yet. */
  isNew: boolean;
  dirty: boolean;

  loadFromImport: (workout: Workout, extractionId: string) => void;
  loadExisting: (workout: Workout) => void;
  /** Apply a pure editing operation from core/editing. */
  apply: (operation: (workout: Workout) => Workout, editedField?: string) => void;
  save: () => Promise<Workout | null>;
  clear: () => void;
}

export const useDraftStore = create<DraftState>((set, get) => ({
  workout: null,
  isNew: false,
  dirty: false,

  loadFromImport(workout, extractionId) {
    set({ workout: { ...workout, extractionId }, isNew: true, dirty: false });
    track({
      name: 'extraction_reviewed',
      workoutId: workout.id,
      fieldsNeedingReview: countFieldsNeedingReview(workout),
    });
  },

  loadExisting(workout) {
    set({ workout, isNew: false, dirty: false });
  },

  apply(operation, editedField) {
    const current = get().workout;
    if (!current) return;

    const next = operation(current);
    set({ workout: next, dirty: true });

    // Field-level correction telemetry: this is what reveals WHERE extraction
    // is failing, which is more actionable than an overall accuracy number.
    if (editedField) {
      track({
        name: 'extraction_edited',
        workoutId: current.id,
        field: editedField,
        hadExtractedValue: current.extractionId !== undefined,
      });
    }
  },

  async save() {
    const { workout, dirty } = get();
    if (!workout) return null;

    await repositories.workouts.save(workout);
    track({ name: 'workout_saved', workoutId: workout.id, edited: dirty });
    set({ isNew: false, dirty: false });

    void useLibraryStore.getState().load();
    return workout;
  },

  clear() {
    set({ workout: null, isNew: false, dirty: false });
  },
}));

/**
 * How many extracted values the user should look at before training.
 * Counts both unclear readings and missing prescriptions (PRD §6, §9).
 */
export function countFieldsNeedingReview(workout: Workout): number {
  let count = 0;

  for (const block of workout.blocks) {
    if (fieldStatus(block.rounds) === 'unclear') count += 1;

    for (const exercise of allExercises({ ...workout, blocks: [block] })) {
      const fields: (ExtractedField<unknown> | undefined)[] = [
        exercise.name,
        exercise.sets,
        exercise.reps,
        exercise.repsPerSide,
        exercise.durationSeconds,
      ];
      for (const field of fields) {
        if (fieldStatus(field) === 'unclear') count += 1;
      }
      // An exercise with no prescription at all is one thing to review, not three.
      const noPrescription =
        exercise.reps?.value == null &&
        exercise.repsPerSide?.value == null &&
        exercise.durationSeconds?.value == null;
      if (noPrescription) count += 1;
    }
  }

  return count;
}
