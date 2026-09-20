import type { AnalyticsEvent, Tracker } from './events';

/**
 * Getting events off the device without getting in the user's way.
 *
 * The naive version — one HTTP request per event, fired where it happens — is wrong
 * on mobile for three reasons, and all three show up as *wrong numbers* rather than
 * as errors, which is what makes them worth engineering around:
 *
 *   1. A request per event on a cellular connection is slow and wasteful, and the
 *      events we care about cluster (import_started then import_succeeded seconds
 *      apart). So events are batched.
 *   2. People lose signal mid-workout, and a workout is exactly when they are least
 *      likely to have it. Dropped events would read as users abandoning workouts.
 *      So the queue is persisted and survives restarts.
 *   3. Analytics must never block or break the product. Every failure path here ends
 *      in "keep the events and try later", never in a thrown error.
 */

export interface AnalyticsSink {
  readonly id: string;
  /** Resolves true when the batch was accepted. False means keep it and retry. */
  send(events: DeliverableEvent[]): Promise<boolean>;
}

/** An event with the envelope the sink needs, ready to serialise. */
export interface DeliverableEvent {
  name: string;
  /** Epoch ms, captured when it happened — not when it was delivered. */
  at: number;
  /** Stable anonymous install id. Never a user id, email or URL. */
  deviceId: string;
  properties: Record<string, unknown>;
}

export interface QueueStore {
  load(): Promise<unknown[]>;
  save(events: unknown[]): Promise<void>;
  deviceId(): Promise<string>;
}

export interface BatchingTrackerOptions {
  sink: AnalyticsSink;
  store: QueueStore;
  /** Send once this many events are queued. */
  batchSize?: number;
  /** Or once this long has passed, whichever comes first. */
  flushIntervalMs?: number;
  /**
   * Hard cap on the queue. Analytics must never grow without bound on someone's
   * phone; past this, the oldest events are dropped.
   */
  maxQueued?: number;
  now?: () => number;
}

const DEFAULTS = {
  batchSize: 20,
  flushIntervalMs: 30_000,
  maxQueued: 500,
} as const;

export class BatchingTracker implements Tracker {
  private queue: DeliverableEvent[] = [];
  private deviceId: string | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private flushing = false;
  private ready: Promise<void>;

  constructor(private readonly options: BatchingTrackerOptions) {
    this.ready = this.restore();
  }

  /**
   * Fire-and-forget by design: call sites are product code and must not await
   * analytics, so this returns void and swallows everything.
   */
  track(event: AnalyticsEvent): void {
    // Stamp the time HERE, synchronously. Everything after this point is async —
    // waiting on storage, on a restore — and reading the clock over there would
    // record when the queue got round to the event rather than when it happened.
    // On a busy event loop that is the difference between a real duration and a
    // fabricated one.
    void this.enqueue(event, this.now());
  }

  private async enqueue(event: AnalyticsEvent, at: number): Promise<void> {
    try {
      await this.ready;
      const { name, ...properties } = event;

      this.queue.push({
        name,
        at,
        deviceId: this.deviceId ?? 'unknown',
        properties,
      });

      // Drop from the front: recent events are more useful than old ones, and an
      // unbounded queue on a phone is its own bug.
      const maxQueued = this.options.maxQueued ?? DEFAULTS.maxQueued;
      if (this.queue.length > maxQueued) {
        this.queue = this.queue.slice(this.queue.length - maxQueued);
      }

      await this.persist();

      if (this.queue.length >= (this.options.batchSize ?? DEFAULTS.batchSize)) {
        await this.flush();
      } else {
        this.scheduleFlush();
      }
    } catch {
      // Analytics failing is never the product's problem.
    }
  }

  /** Send everything queued. Safe to call at any time, including concurrently. */
  async flush(): Promise<void> {
    await this.ready;
    if (this.flushing || this.queue.length === 0) return;

    this.flushing = true;
    this.clearTimer();

    // Snapshot rather than clear: if the send fails the events must still be here.
    const batch = [...this.queue];

    try {
      const accepted = await this.options.sink.send(batch);
      if (accepted) {
        // Only remove what we sent — anything enqueued during the request stays.
        this.queue = this.queue.slice(batch.length);
        await this.persist();
      }
    } catch {
      // Keep the batch and try again on the next flush.
    } finally {
      this.flushing = false;
      if (this.queue.length > 0) this.scheduleFlush();
    }
  }

  private scheduleFlush(): void {
    if (this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.flush();
    }, this.options.flushIntervalMs ?? DEFAULTS.flushIntervalMs);
  }

  private clearTimer(): void {
    if (!this.timer) return;
    clearTimeout(this.timer);
    this.timer = null;
  }

  private async restore(): Promise<void> {
    try {
      this.deviceId = await this.options.store.deviceId();
      const stored = await this.options.store.load();
      this.queue = stored.filter(isDeliverableEvent);
    } catch {
      this.queue = [];
    }
  }

  private async persist(): Promise<void> {
    try {
      await this.options.store.save(this.queue);
    } catch {
      // A full disk must not take the app down.
    }
  }

  private now(): number {
    return this.options.now?.() ?? Date.now();
  }

  /** Test seam: what is currently waiting to be delivered. */
  pending(): DeliverableEvent[] {
    return [...this.queue];
  }
}

function isDeliverableEvent(value: unknown): value is DeliverableEvent {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<DeliverableEvent>;
  return typeof candidate.name === 'string' && typeof candidate.at === 'number';
}
