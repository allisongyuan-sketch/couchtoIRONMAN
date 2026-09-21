import type { Workout } from '../schema/workout';
import type { SessionSummary } from '../schema/session';

/**
 * The remote side of sync.
 *
 * **Why documents rather than the relational tables.**
 *
 * `supabase/migrations/0001_init.sql` models workouts relationally — blocks,
 * prescriptions, a shared exercise catalog — because that is what server-side
 * querying will eventually need (which movements recur, what a creator's workouts
 * have in common, training analytics).
 *
 * None of that is needed to stop someone losing their workouts when they change
 * phones, which is all sync has to do today. Shredding a nested document into five
 * tables and reassembling it is a meaningful amount of code with a meaningful number
 * of places to silently drop a field — provenance especially — and it buys nothing
 * the MVP uses.
 *
 * So sync stores the document, and the relational tables become a projection to build
 * when something actually queries them. The document stays the source of truth either
 * way, which is the property that makes the projection safe to add later.
 */
export interface RemoteWorkoutStore {
  list(userId: string): Promise<Workout[]>;
  upsertMany(userId: string, workouts: Workout[]): Promise<void>;
}

export interface RemoteHistoryStore {
  list(userId: string): Promise<SessionSummary[]>;
  upsertMany(userId: string, entries: SessionSummary[]): Promise<void>;
}

export interface SyncReport {
  workoutsUploaded: number;
  workoutsDownloaded: number;
  historyUploaded: number;
  historyDownloaded: number;
  conflicts: number;
}

export type SyncOutcome =
  | { status: 'ok'; report: SyncReport }
  | { status: 'skipped'; reason: 'not_signed_in' | 'not_configured' }
  | { status: 'failed'; reason: string; retryable: boolean };

export const EMPTY_SYNC_REPORT: SyncReport = {
  workoutsUploaded: 0,
  workoutsDownloaded: 0,
  historyUploaded: 0,
  historyDownloaded: 0,
  conflicts: 0,
};
