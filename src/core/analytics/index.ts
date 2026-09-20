import { ConsoleTracker, type AnalyticsEvent, type Tracker } from './events';

export * from './events';

let tracker: Tracker = new ConsoleTracker();

export function setTracker(next: Tracker): void {
  tracker = next;
}

export function track(event: AnalyticsEvent): void {
  tracker.track(event);
}
