import { create } from 'zustand';
import type { SessionSummary } from '@/core/schema/session';
import { repositories } from './container';

/**
 * Completed workouts (PRD §17).
 *
 * Deliberately just a log. Volume, weights, personal records, streaks and training
 * analytics are explicitly out of scope for the MVP — the session records carry
 * enough detail to compute them later without a migration.
 */
interface HistoryState {
  entries: SessionSummary[];
  loading: boolean;
  load: () => Promise<void>;
}

export const useHistoryStore = create<HistoryState>((set) => ({
  entries: [],
  loading: false,
  async load() {
    set({ loading: true });
    try {
      set({ entries: await repositories.sessions.listHistory() });
    } finally {
      set({ loading: false });
    }
  },
}));
