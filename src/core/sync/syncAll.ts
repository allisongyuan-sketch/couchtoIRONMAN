import type { SessionRepository, WorkoutRepository } from '@/data/repositories';
import { mergeById, mergeHistory } from './merge';
import {
  EMPTY_SYNC_REPORT,
  type RemoteHistoryStore,
  type RemoteWorkoutStore,
  type SyncOutcome,
} from './types';

/**
 * Reconcile local and remote, in both directions.
 *
 * Runs against the same `WorkoutRepository` / `SessionRepository` ports the app has
 * used since before accounts existed — which is the payoff for defining them as ports
 * in the first place. Sync is a new caller, not a rewrite.
 *
 * It is also safe to run repeatedly: the merge is a union keyed by id, so a second
 * run over unchanged data produces no writes at all.
 */
export async function syncAll(args: {
  userId: string | null;
  local: { workouts: WorkoutRepository; sessions: SessionRepository };
  remote: { workouts: RemoteWorkoutStore | null; history: RemoteHistoryStore | null };
}): Promise<SyncOutcome> {
  const { userId, local, remote } = args;

  if (!userId) return { status: 'skipped', reason: 'not_signed_in' };
  if (!remote.workouts || !remote.history) return { status: 'skipped', reason: 'not_configured' };

  try {
    const [localWorkouts, remoteWorkouts, localHistory, remoteHistory] = await Promise.all([
      local.workouts.list(),
      remote.workouts.list(userId),
      local.sessions.listHistory(),
      remote.history.list(userId),
    ]);

    const workouts = mergeById(localWorkouts, remoteWorkouts, {
      getId: (workout) => workout.id,
      getVersion: (workout) => workout.updatedAt,
    });

    const history = mergeHistory(
      localHistory,
      remoteHistory,
      (entry) => entry.sessionId,
      (entry) => entry.completedAt,
    );

    // Upload first. If the process dies midway, the user's local work is already
    // safe on the server — which is the direction that matters, since anything we
    // failed to download is still sitting on the server for next time.
    if (workouts.toUpload.length > 0) {
      await remote.workouts.upsertMany(userId, workouts.toUpload);
    }
    if (history.toUpload.length > 0) {
      await remote.history.upsertMany(userId, history.toUpload);
    }

    for (const workout of workouts.toDownload) {
      await local.workouts.save(workout);
    }
    for (const entry of history.toDownload) {
      await local.sessions.appendHistory(entry);
    }

    return {
      status: 'ok',
      report: {
        ...EMPTY_SYNC_REPORT,
        workoutsUploaded: workouts.toUpload.length,
        workoutsDownloaded: workouts.toDownload.length,
        historyUploaded: history.toUpload.length,
        historyDownloaded: history.toDownload.length,
        conflicts: workouts.conflicts.length + history.conflicts.length,
      },
    };
  } catch (error) {
    return {
      status: 'failed',
      reason: error instanceof Error ? error.message : 'Sync failed',
      // Sync failing is never fatal: the local copy is intact and the next attempt
      // reconciles from wherever this one stopped.
      retryable: true,
    };
  }
}
