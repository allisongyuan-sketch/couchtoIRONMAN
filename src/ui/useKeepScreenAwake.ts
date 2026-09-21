import { useEffect } from 'react';
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';

/**
 * Keep the screen on for as long as a workout is on it.
 *
 * Nobody wants the display sleeping between sets, so this matters — but it is a
 * nicety, not a requirement, and it must never be able to interrupt a workout.
 *
 * `useKeepAwake()` from expo-keep-awake offers no way to catch its internal
 * rejection, and on web a wake lock legitimately fails: browser support is limited,
 * and the Screen Wake Lock API refuses outright when the page is not visible. That
 * surfaced as an unhandled page error — harmless to the user, but real, and exactly
 * the kind of noise that trains people to ignore error reporting.
 *
 * So both calls are guarded, the same way `haptics.ts` guards every call it makes.
 * If the platform says no, the workout carries on and nobody hears about it.
 */
export function useKeepScreenAwake(tag = 'repurpose-workout'): void {
  useEffect(() => {
    let released = false;

    void activateKeepAwakeAsync(tag).catch(() => {
      // Unsupported browser, or a page that is not visible. Not our problem.
    });

    return () => {
      if (released) return;
      released = true;
      try {
        // Synchronous on some platforms, a rejected promise on others.
        void Promise.resolve(deactivateKeepAwake(tag)).catch(() => {});
      } catch {
        /* nothing to release */
      }
    };
  }, [tag]);
}
