/**
 * The conversion funnel (PRD §29).
 *
 * The events are a typed union rather than loose strings so that a renamed or
 * mistyped event is a compile error, not a silently missing metric. The funnel we
 * actually care about is import → workout start (PRD §30); time-in-app is
 * deliberately not measured, because the product's goal is to get people off their
 * phone and moving.
 */

export type AnalyticsEvent =
  | { name: 'import_started'; source: 'share_sheet' | 'paste_link' | 'upload' | 'manual' }
  | { name: 'import_succeeded'; platform: string; durationMs: number; exerciseCount: number }
  | { name: 'import_failed'; platform: string; reason: string; retryable: boolean }
  | { name: 'extraction_reviewed'; workoutId: string; fieldsNeedingReview: number }
  /**
   * Field-level correction telemetry. PRD §29: correction rate reveals WHERE
   * extraction is failing, which is far more actionable than an overall accuracy score.
   */
  | { name: 'extraction_edited'; workoutId: string; field: string; hadExtractedValue: boolean }
  | { name: 'workout_saved'; workoutId: string; edited: boolean }
  | { name: 'workout_started'; workoutId: string; stepCount: number }
  | {
      name: 'workout_completed';
      workoutId: string;
      durationSeconds: number;
      exercisesCompleted: number;
      exercisesTotal: number;
    }
  | { name: 'workout_abandoned'; workoutId: string; progressRatio: number };

export type AnalyticsEventName = AnalyticsEvent['name'];

/** The port. Swap the adapter to point at a real sink without touching call sites. */
export interface Tracker {
  track(event: AnalyticsEvent): void;
}

export class ConsoleTracker implements Tracker {
  track(event: AnalyticsEvent): void {
    if (__DEV__) console.log('[analytics]', event.name, event);
  }
}

/** Retains events in memory. Used by tests and by the in-app debug view. */
export class MemoryTracker implements Tracker {
  readonly events: AnalyticsEvent[] = [];
  track(event: AnalyticsEvent): void {
    this.events.push(event);
  }
  names(): string[] {
    return this.events.map((event) => event.name);
  }
}

declare const __DEV__: boolean;
