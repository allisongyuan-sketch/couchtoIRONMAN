import { describe, expect, it } from 'vitest';
import { MemoryKeyValueStore } from './keyValueStore';
import { createRepositories } from './repositories';
import { normalizeExtraction } from '@/core/extraction/normalize';
import { LEG_DAY_CIRCUIT, HIP_MOBILITY_FLOW } from '@/core/extraction/fixtures';
import { compilePlan } from '@/core/engine/plan';
import { createSession, sessionReducer } from '@/core/engine/session';
import { summarize } from '@/core/engine/selectors';

function repos() {
  return createRepositories(new MemoryKeyValueStore());
}

describe('repositories', () => {
  it('round-trips a workout without losing provenance', async () => {
    const { workouts } = repos();
    const { workout } = normalizeExtraction(LEG_DAY_CIRCUIT, { platform: 'tiktok' });

    await workouts.save(workout);
    const loaded = await workouts.get(workout.id);

    expect(loaded).toEqual(workout);
    // The detail that would be easiest to lose in a naive serializer.
    expect(loaded?.blocks[0]?.exercises[0]?.formCues[0]?.source).toBe('speech');
  });

  it('updates in place rather than duplicating', async () => {
    const { workouts } = repos();
    const { workout } = normalizeExtraction(LEG_DAY_CIRCUIT, { platform: 'tiktok' });

    await workouts.save(workout);
    await workouts.save({ ...workout, title: 'Renamed' });

    const all = await workouts.list();
    expect(all).toHaveLength(1);
    expect(all[0]?.title).toBe('Renamed');
  });

  it('lists workouts most-recently-updated first', async () => {
    const { workouts } = repos();
    const a = normalizeExtraction(LEG_DAY_CIRCUIT, { platform: 'tiktok' }).workout;
    const b = normalizeExtraction(HIP_MOBILITY_FLOW, { platform: 'instagram' }).workout;

    await workouts.save({ ...a, updatedAt: '2026-01-01T00:00:00.000Z' });
    await workouts.save({ ...b, updatedAt: '2026-02-01T00:00:00.000Z' });

    expect((await workouts.list()).map((w) => w.id)).toEqual([b.id, a.id]);
  });

  it('skips unreadable records instead of failing the whole read', async () => {
    // A record written by an older app version must not brick the library screen.
    const store = new MemoryKeyValueStore();
    const { workouts } = createRepositories(store);
    const { workout } = normalizeExtraction(LEG_DAY_CIRCUIT, { platform: 'tiktok' });
    await workouts.save(workout);

    const raw = JSON.parse((await store.getItem('repurpose:workouts:v1'))!);
    await store.setItem('repurpose:workouts:v1', JSON.stringify([...raw, { nonsense: true }]));

    const all = await workouts.list();
    expect(all).toHaveLength(1);
    expect(all[0]?.id).toBe(workout.id);
  });

  it('returns an empty list rather than throwing on corrupt storage', async () => {
    const store = new MemoryKeyValueStore();
    await store.setItem('repurpose:workouts:v1', 'not json');
    expect(await createRepositories(store).workouts.list()).toEqual([]);
  });

  it('dedupes the exercise catalog by slug across imports', async () => {
    const { exercises } = repos();
    const first = normalizeExtraction(LEG_DAY_CIRCUIT, { platform: 'tiktok' });
    const second = normalizeExtraction(LEG_DAY_CIRCUIT, { platform: 'instagram' });

    await exercises.upsertMany(first.exercises);
    await exercises.upsertMany(second.exercises);

    // Three movements, not six — the catalog is shared, not per-workout.
    expect(await exercises.list()).toHaveLength(3);
    expect((await exercises.findBySlug('bulgarian-split-squat'))?.displayName).toBe(
      'Bulgarian Split Squat',
    );
  });

  it('persists an in-progress session and restores it exactly', async () => {
    const { sessions } = repos();
    const { workout } = normalizeExtraction(LEG_DAY_CIRCUIT, { platform: 'tiktok' });
    const plan = compilePlan(workout);

    let session = createSession(workout, plan, 1_000);
    session = sessionReducer(session, plan, { type: 'START', now: 1_000 });
    session = sessionReducer(session, plan, { type: 'COMPLETE_STEP', now: 31_000 });

    await sessions.saveActive(session);

    // Simulate a cold launch: a brand new repository over the same bytes.
    const restored = await sessions.getActive();
    expect(restored).toEqual(session);
    expect(restored?.currentStepIndex).toBe(1);

    await sessions.clearActive();
    expect(await sessions.getActive()).toBeNull();
  });

  it('records completed workouts in history, newest first', async () => {
    const { sessions } = repos();
    const { workout } = normalizeExtraction(LEG_DAY_CIRCUIT, { platform: 'tiktok' });
    const plan = compilePlan(workout);
    const session = createSession(workout, plan, 1_000);

    await sessions.appendHistory({ ...summarize(plan, session, 5_000), completedAt: 100 });
    await sessions.appendHistory({ ...summarize(plan, session, 5_000), completedAt: 200 });

    expect((await sessions.listHistory()).map((s) => s.completedAt)).toEqual([200, 100]);
  });

  it('persists monthly import usage', async () => {
    const { importUsage } = repos();
    expect(await importUsage.get()).toBeNull();

    await importUsage.set({ month: '2026-01', count: 2 });
    expect(await importUsage.get()).toEqual({ month: '2026-01', count: 2 });
  });

  it('treats corrupt usage as no usage rather than blocking imports', async () => {
    // Failing open matters here: a bad record must not lock someone out of the
    // feature they may be paying for.
    const store = new MemoryKeyValueStore();
    await store.setItem('repurpose:import-usage:v1', 'not json');
    expect(await createRepositories(store).importUsage.get()).toBeNull();
  });

  it('keeps a stable anonymous device id across calls', async () => {
    const { analyticsQueue } = repos();
    const first = await analyticsQueue.deviceId();
    const second = await analyticsQueue.deviceId();

    expect(first).toBe(second);
    expect(first).toMatch(/^dev_/);
  });

  it('round-trips the analytics queue and tolerates corruption', async () => {
    const { analyticsQueue } = repos();
    expect(await analyticsQueue.load()).toEqual([]);

    await analyticsQueue.save([{ name: 'import_started', at: 1 }]);
    expect(await analyticsQueue.load()).toHaveLength(1);

    const store = new MemoryKeyValueStore();
    await store.setItem('repurpose:analytics:queue:v1', '{not an array}');
    expect(await createRepositories(store).analyticsQueue.load()).toEqual([]);
  });

  it('remembers that onboarding is done', async () => {
    const { preferences } = repos();
    expect(await preferences.hasOnboarded()).toBe(false);
    await preferences.setOnboarded(true);
    expect(await preferences.hasOnboarded()).toBe(true);
  });
});
