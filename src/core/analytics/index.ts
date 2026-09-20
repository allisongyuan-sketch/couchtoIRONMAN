import { ConsoleTracker, type AnalyticsEvent, type Tracker } from './events';

export * from './events';
export * from './transport';
export * from './httpSink';

let tracker: Tracker = new ConsoleTracker();

export function setTracker(next: Tracker): void {
  tracker = next;
}

export function track(event: AnalyticsEvent): void {
  tracker.track(event);
}

/**
 * Deliver anything queued right now.
 *
 * Called when the app goes to the background, which on mobile is the last reliable
 * moment to send: the alternative is losing the tail of every session, and the tail
 * is where completions live.
 */
export async function flushAnalytics(): Promise<void> {
  const flushable = tracker as Tracker & { flush?: () => Promise<void> };
  if (typeof flushable.flush === 'function') await flushable.flush();
}
