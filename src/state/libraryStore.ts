import { create } from 'zustand';
import type { Workout } from '@/core/schema/workout';
import { exerciseCount } from '@/core/schema/workout';
import { repositories } from './container';

interface LibraryState {
  workouts: Workout[];
  loading: boolean;
  query: string;
  load: () => Promise<void>;
  setQuery: (query: string) => void;
  remove: (id: string) => Promise<void>;
  visible: () => Workout[];
}

/**
 * The saved library (PRD §16). Search only — no categorisation, no filters, no feed.
 * The PRD is explicit that this is not a discovery product.
 */
export const useLibraryStore = create<LibraryState>((set, get) => ({
  workouts: [],
  loading: false,
  query: '',

  async load() {
    set({ loading: true });
    try {
      set({ workouts: await repositories.workouts.list() });
    } finally {
      set({ loading: false });
    }
  },

  setQuery(query) {
    set({ query });
  },

  async remove(id) {
    await repositories.workouts.remove(id);
    set({ workouts: get().workouts.filter((workout) => workout.id !== id) });
  },

  visible() {
    const { workouts, query } = get();
    return filterWorkouts(workouts, query);
  },
}));

/** Exported for testing: search is pure, so it does not need a store to verify. */
export function filterWorkouts(workouts: Workout[], query: string): Workout[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return workouts;

  return workouts.filter((workout) => {
    const haystack = [
      workout.title,
      workout.source.creatorHandle ?? '',
      workout.source.platform,
      ...workout.blocks.flatMap((block) =>
        block.exercises.map((exercise) => exercise.name.value ?? ''),
      ),
    ]
      .join(' ')
      .toLowerCase();
    return haystack.includes(needle);
  });
}

export function workoutSubtitle(workout: Workout): string {
  const count = exerciseCount(workout);
  return `${count} ${count === 1 ? 'exercise' : 'exercises'}`;
}
