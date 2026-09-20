import { describe, expect, it, vi } from 'vitest';
import { syncAll } from './syncAll';
import { MemoryKeyValueStore } from '@/data/keyValueStore';
import { createRepositories } from '@/data/repositories';
import { normalizeExtraction } from '@/core/extraction/normalize';
import { HIP_MOBILITY_FLOW, LEG_DAY_CIRCUIT } from '@/core/extraction/fixtures';
import type { RemoteHistoryStore, RemoteWorkoutStore } from './types';
import type { Workout } from '@/core/schema/workout';
import type { SessionSummary } from '@/core/schema/session';

/** An in-memory stand-in for the server side. */
function remoteStores(seed: { workouts?: Workout[]; history?: SessionSummary[] } = {}) {
  const workouts = [...(seed.workouts ?? [])];
  const history = [...(seed.history ?? [])];

  const workoutStore: RemoteWorkoutStore = {
    list: vi.fn(async () => [...workouts]),
    upsertMany: vi.fn(async (_userId, incoming) => {
      for (const item of incoming) {
        const index = workouts.findIndex((w) => w.id === item.id);
        if (index >= 0) workouts[index] = item;
        else workouts.push(item);
      }
    }),
  };

  const historyStore: RemoteHistoryStore = {
    list: vi.fn(async () => [...history]),
    upsertMany: vi.fn(async (_userId, incoming) => {
      for (const item of incoming) {
        if (!history.some((h) => h.sessionId === item.sessionId)) history.push(item);
      }
    }),
  };

  return { workoutStore, historyStore, workouts, history };
}

function workout(raw = LEG_DAY_CIRCUIT, updatedAt = '2026-01-01T00:00:00.000Z'): Workout {
  const { workout: built } = normalizeExtraction(raw, { platform: 'tiktok' });
  return { ...built, updatedAt };
}

function summary(sessionId: string, completedAt: number): SessionSummary {
  return {
    sessionId,
    workoutId: 'wk_1',
    workoutTitle: 'Leg Day',
    completedAt,
    durationSeconds: 1800,
    exercisesCompleted: 3,
    exercisesTotal: 3,
  };
}

function localRepos() {
  return createRepositories(new MemoryKeyValueStore());
}

describe('syncAll', () => {
  it('uploads everything the first time someone signs in', async () => {
    const local = localRepos();
    await local.workouts.save(workout());
    await local.sessions.appendHistory(summary('s1', 100));

    const remote = remoteStores();
    const outcome = await syncAll({
      userId: 'u1',
      local,
      remote: { workouts: remote.workoutStore, history: remote.historyStore },
    });

    expect(outcome.status).toBe('ok');
    if (outcome.status !== 'ok') return;
    expect(outcome.report.workoutsUploaded).toBe(1);
    expect(outcome.report.historyUploaded).toBe(1);
    expect(remote.workouts).toHaveLength(1);
  });

  it('downloads everything onto a fresh device', async () => {
    const local = localRepos();
    const remote = remoteStores({ workouts: [workout()], history: [summary('s1', 100)] });

    const outcome = await syncAll({
      userId: 'u1',
      local,
      remote: { workouts: remote.workoutStore, history: remote.historyStore },
    });

    expect(outcome.status).toBe('ok');
    if (outcome.status !== 'ok') return;
    expect(outcome.report.workoutsDownloaded).toBe(1);
    expect(await local.workouts.list()).toHaveLength(1);
    expect(await local.sessions.listHistory()).toHaveLength(1);
  });

  it('keeps both sides when each has work the other has not seen', async () => {
    // Signing in must never cost you a workout.
    const mine = workout(LEG_DAY_CIRCUIT);
    const theirs = workout(HIP_MOBILITY_FLOW);

    const local = localRepos();
    await local.workouts.save(mine);
    const remote = remoteStores({ workouts: [theirs] });

    await syncAll({
      userId: 'u1',
      local,
      remote: { workouts: remote.workoutStore, history: remote.historyStore },
    });

    const localIds = (await local.workouts.list()).map((w) => w.id).sort();
    expect(localIds).toEqual([mine.id, theirs.id].sort());
    expect(remote.workouts).toHaveLength(2);
  });

  it('lets the newer edit win when the same workout changed on both devices', async () => {
    const base = workout();
    const localNewer = { ...base, title: 'Edited here', updatedAt: '2026-06-01T00:00:00.000Z' };
    const remoteOlder = { ...base, title: 'Edited there', updatedAt: '2026-03-01T00:00:00.000Z' };

    const local = localRepos();
    await local.workouts.save(localNewer);
    const remote = remoteStores({ workouts: [remoteOlder] });

    const outcome = await syncAll({
      userId: 'u1',
      local,
      remote: { workouts: remote.workoutStore, history: remote.historyStore },
    });

    expect(outcome.status).toBe('ok');
    if (outcome.status !== 'ok') return;
    expect(outcome.report.conflicts).toBe(1);
    expect(remote.workouts[0]?.title).toBe('Edited here');
  });

  it('writes nothing on a second run over unchanged data', async () => {
    const local = localRepos();
    await local.workouts.save(workout());
    const remote = remoteStores();

    await syncAll({
      userId: 'u1',
      local,
      remote: { workouts: remote.workoutStore, history: remote.historyStore },
    });
    vi.mocked(remote.workoutStore.upsertMany).mockClear();

    const second = await syncAll({
      userId: 'u1',
      local,
      remote: { workouts: remote.workoutStore, history: remote.historyStore },
    });

    expect(second.status).toBe('ok');
    if (second.status !== 'ok') return;
    expect(second.report.workoutsUploaded).toBe(0);
    expect(second.report.workoutsDownloaded).toBe(0);
    expect(remote.workoutStore.upsertMany).not.toHaveBeenCalled();
  });

  it('preserves provenance across a round trip', async () => {
    // The detail most likely to be quietly lost in a sync layer.
    const local = localRepos();
    const remote = remoteStores({ workouts: [workout()] });

    await syncAll({
      userId: 'u1',
      local,
      remote: { workouts: remote.workoutStore, history: remote.historyStore },
    });

    const downloaded = (await local.workouts.list())[0];
    const cue = downloaded?.blocks[0]?.exercises[0]?.formCues[0];
    expect(cue?.source).toBe('speech');
    expect(downloaded?.blocks[0]?.rounds?.confidence).toBeDefined();
  });

  it('does nothing when signed out', async () => {
    const remote = remoteStores();
    const outcome = await syncAll({
      userId: null,
      local: localRepos(),
      remote: { workouts: remote.workoutStore, history: remote.historyStore },
    });

    expect(outcome).toEqual({ status: 'skipped', reason: 'not_signed_in' });
    expect(remote.workoutStore.list).not.toHaveBeenCalled();
  });

  it('does nothing when no backend is configured', async () => {
    const outcome = await syncAll({
      userId: 'u1',
      local: localRepos(),
      remote: { workouts: null, history: null },
    });
    expect(outcome).toEqual({ status: 'skipped', reason: 'not_configured' });
  });

  it('leaves local data intact when the server is unreachable', async () => {
    // Sync failing must never cost the user anything.
    const local = localRepos();
    await local.workouts.save(workout());

    const outcome = await syncAll({
      userId: 'u1',
      local,
      remote: {
        workouts: {
          list: async () => {
            throw new Error('network down');
          },
          upsertMany: async () => {},
        },
        history: { list: async () => [], upsertMany: async () => {} },
      },
    });

    expect(outcome).toMatchObject({ status: 'failed', retryable: true });
    expect(await local.workouts.list()).toHaveLength(1);
  });

  it('uploads before downloading, so local work is safe first', async () => {
    // If the process dies midway, anything not downloaded is still on the server;
    // anything not uploaded would only exist on a device that may be replaced.
    const order: string[] = [];
    const local = localRepos();
    await local.workouts.save(workout());

    await syncAll({
      userId: 'u1',
      local,
      remote: {
        workouts: {
          list: async () => {
            order.push('list');
            return [workout(HIP_MOBILITY_FLOW)];
          },
          upsertMany: async () => {
            order.push('upload');
          },
        },
        history: { list: async () => [], upsertMany: async () => {} },
      },
    });

    expect(order).toEqual(['list', 'upload']);
    // The download landed after the upload.
    expect(await local.workouts.list()).toHaveLength(2);
  });
});
