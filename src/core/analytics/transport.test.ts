import { describe, expect, it, vi } from 'vitest';
import { BatchingTracker, type AnalyticsSink, type DeliverableEvent, type QueueStore } from './transport';
import type { AnalyticsEvent } from './events';

function memoryStore(seed: unknown[] = [], deviceId = 'dev_1'): QueueStore & { saved: unknown[] } {
  let events = [...seed];
  return {
    get saved() {
      return events;
    },
    load: async () => [...events],
    save: async (next) => {
      events = [...next];
    },
    deviceId: async () => deviceId,
  };
}

function sink(behaviour: (events: DeliverableEvent[]) => boolean | Promise<boolean>) {
  const send = vi.fn(async (events: DeliverableEvent[]) => behaviour(events));
  return { send, sink: { id: 'stub', send } satisfies AnalyticsSink };
}

const started: AnalyticsEvent = { name: 'import_started', source: 'paste_link' };

function workoutStarted(id: string): AnalyticsEvent {
  return { name: 'workout_started', workoutId: id, stepCount: 9 };
}

describe('BatchingTracker', () => {
  it('batches rather than sending one request per event', async () => {
    const accepted = sink(() => true);
    const tracker = new BatchingTracker({
      sink: accepted.sink,
      store: memoryStore(),
      batchSize: 3,
    });

    tracker.track(started);
    tracker.track(started);
    await tracker.flush();
    // Under the batch size, nothing is sent until a flush.
    expect(accepted.send).toHaveBeenCalledTimes(1);
    expect(accepted.send.mock.calls[0]?.[0]).toHaveLength(2);
  });

  it('sends automatically once the batch fills', async () => {
    const accepted = sink(() => true);
    const tracker = new BatchingTracker({
      sink: accepted.sink,
      store: memoryStore(),
      batchSize: 2,
    });

    tracker.track(started);
    tracker.track(started);
    await vi.waitFor(() => expect(accepted.send).toHaveBeenCalled());
    expect(tracker.pending()).toHaveLength(0);
  });

  it('keeps events when delivery fails, so a tunnel does not lose a funnel', async () => {
    // A dropped workout_completed reads as a user abandoning a workout. It is not.
    const failing = sink(() => false);
    const tracker = new BatchingTracker({
      sink: failing.sink,
      store: memoryStore(),
      batchSize: 10,
    });

    tracker.track(started);
    await tracker.flush();

    expect(tracker.pending()).toHaveLength(1);
  });

  it('retries the same events on the next flush and clears them once accepted', async () => {
    let online = false;
    const flaky = sink(() => online);
    const tracker = new BatchingTracker({ sink: flaky.sink, store: memoryStore(), batchSize: 10 });

    tracker.track(started);
    await tracker.flush();
    expect(tracker.pending()).toHaveLength(1);

    online = true;
    await tracker.flush();
    expect(tracker.pending()).toHaveLength(0);
  });

  it('survives a restart with the queue intact', async () => {
    const store = memoryStore();
    const offline = sink(() => false);

    const first = new BatchingTracker({ sink: offline.sink, store, batchSize: 10 });
    first.track(started);
    await first.flush();
    expect(store.saved).toHaveLength(1);

    // A brand new tracker over the same storage — i.e. a cold launch.
    const accepted = sink(() => true);
    const second = new BatchingTracker({ sink: accepted.sink, store, batchSize: 10 });
    await second.flush();

    expect(accepted.send.mock.calls[0]?.[0]).toHaveLength(1);
    expect(second.pending()).toHaveLength(0);
  });

  it('keeps events enqueued during an in-flight send', async () => {
    // Otherwise a slow request silently swallows whatever happened while it ran.
    let release: (value: boolean) => void = () => {};
    const slow = sink(
      () =>
        new Promise<boolean>((resolve) => {
          release = resolve;
        }),
    );

    const tracker = new BatchingTracker({ sink: slow.sink, store: memoryStore(), batchSize: 10 });
    tracker.track(started);

    const inFlight = tracker.flush();
    await vi.waitFor(() => expect(slow.send).toHaveBeenCalled());
    tracker.track(workoutStarted('wk_during'));

    release(true);
    await inFlight;

    // The first event was accepted and removed; the one that arrived mid-flight stays.
    expect(tracker.pending().map((event) => event.name)).toEqual(['workout_started']);
  });

  it('caps the queue so it cannot grow without bound on a phone', async () => {
    const offline = sink(() => false);
    const tracker = new BatchingTracker({
      sink: offline.sink,
      store: memoryStore(),
      batchSize: 1000,
      maxQueued: 5,
    });

    for (let i = 0; i < 20; i += 1) tracker.track(workoutStarted(`wk_${i}`));
    await vi.waitFor(() => expect(tracker.pending()).toHaveLength(5));

    // The newest survive: recent events are more useful than stale ones.
    const ids = tracker.pending().map((event) => event.properties['workoutId']);
    expect(ids).toEqual(['wk_15', 'wk_16', 'wk_17', 'wk_18', 'wk_19']);
  });

  it('stamps events with the time they happened, not the time they were sent', async () => {
    let clock = 1_000;
    const accepted = sink(() => true);
    const tracker = new BatchingTracker({
      sink: accepted.sink,
      store: memoryStore(),
      batchSize: 10,
      now: () => clock,
    });

    tracker.track(started);
    clock = 99_000;
    await tracker.flush();

    expect(accepted.send.mock.calls[0]?.[0][0]?.at).toBe(1_000);
  });

  it('attaches an anonymous device id and no user identifiers', async () => {
    const accepted = sink(() => true);
    const tracker = new BatchingTracker({
      sink: accepted.sink,
      store: memoryStore([], 'dev_abc'),
      batchSize: 10,
    });

    tracker.track(started);
    await tracker.flush();

    const sent = accepted.send.mock.calls[0]?.[0][0];
    expect(sent?.deviceId).toBe('dev_abc');
    expect(JSON.stringify(sent)).not.toMatch(/@|https?:\/\//);
  });

  it('never throws at the call site, even when storage is broken', async () => {
    // Product code calls track() without awaiting or catching.
    const brokenStore: QueueStore = {
      load: async () => {
        throw new Error('disk');
      },
      save: async () => {
        throw new Error('disk');
      },
      deviceId: async () => {
        throw new Error('disk');
      },
    };

    const accepted = sink(() => true);
    const tracker = new BatchingTracker({ sink: accepted.sink, store: brokenStore, batchSize: 1 });

    expect(() => tracker.track(started)).not.toThrow();
    await expect(tracker.flush()).resolves.toBeUndefined();
  });

  it('never throws when the sink itself throws', async () => {
    const exploding: AnalyticsSink = {
      id: 'boom',
      send: async () => {
        throw new Error('sink exploded');
      },
    };
    const tracker = new BatchingTracker({ sink: exploding, store: memoryStore(), batchSize: 10 });

    tracker.track(started);
    await expect(tracker.flush()).resolves.toBeUndefined();
    // And the events are kept for a later attempt.
    expect(tracker.pending()).toHaveLength(1);
  });

  it('discards a stored queue entry it cannot understand', async () => {
    const store = memoryStore([{ garbage: true }, { name: 'workout_started', at: 5 }]);
    const accepted = sink(() => true);
    const tracker = new BatchingTracker({ sink: accepted.sink, store, batchSize: 10 });

    await tracker.flush();
    expect(accepted.send.mock.calls[0]?.[0]).toHaveLength(1);
  });
});
