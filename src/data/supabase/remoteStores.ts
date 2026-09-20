import type { SupabaseClient } from '@supabase/supabase-js';
import { workoutSchema } from '@/core/schema/workout';
import type { SessionSummary } from '@/core/schema/session';
import type { RemoteHistoryStore, RemoteWorkoutStore } from '@/core/sync/types';

/**
 * Supabase-backed document stores for sync.
 *
 * Rows are `(user_id, id, document, updated_at)`. Access is decided entirely by Row
 * Level Security — see the policies in the migration — which is what makes shipping
 * the anon key to the client safe.
 *
 * Reads are validated on the way in. Anything the current app cannot parse is skipped
 * rather than crashing the library, exactly as the local repositories do: a row
 * written by a newer app version should cost one workout, not the whole screen.
 */

export function createRemoteWorkoutStore(client: SupabaseClient): RemoteWorkoutStore {
  return {
    async list(userId) {
      const { data, error } = await client
        .from('synced_workouts')
        .select('document')
        .eq('user_id', userId);

      if (error) throw new Error(error.message);

      return (data ?? []).flatMap((row) => {
        const parsed = workoutSchema.safeParse((row as { document: unknown }).document);
        return parsed.success ? [parsed.data] : [];
      });
    },

    async upsertMany(userId, workouts) {
      if (workouts.length === 0) return;

      const { error } = await client.from('synced_workouts').upsert(
        workouts.map((workout) => ({
          user_id: userId,
          id: workout.id,
          document: workout,
          updated_at: workout.updatedAt,
        })),
        { onConflict: 'user_id,id' },
      );

      if (error) throw new Error(error.message);
    },
  };
}

export function createRemoteHistoryStore(client: SupabaseClient): RemoteHistoryStore {
  return {
    async list(userId) {
      const { data, error } = await client
        .from('synced_sessions')
        .select('document')
        .eq('user_id', userId);

      if (error) throw new Error(error.message);

      return (data ?? []).flatMap((row) => {
        const document = (row as { document: unknown }).document;
        return isSessionSummary(document) ? [document] : [];
      });
    },

    async upsertMany(userId, entries) {
      if (entries.length === 0) return;

      const { error } = await client.from('synced_sessions').upsert(
        entries.map((entry) => ({
          user_id: userId,
          id: entry.sessionId,
          document: entry,
          completed_at: new Date(entry.completedAt).toISOString(),
        })),
        { onConflict: 'user_id,id' },
      );

      if (error) throw new Error(error.message);
    },
  };
}

function isSessionSummary(value: unknown): value is SessionSummary {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<SessionSummary>;
  return (
    typeof candidate.sessionId === 'string' &&
    typeof candidate.workoutId === 'string' &&
    typeof candidate.completedAt === 'number'
  );
}
