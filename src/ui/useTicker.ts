import { useEffect, useState } from 'react';
import { AppState } from 'react-native';

/**
 * Re-render on an interval while a timer is running.
 *
 * This drives DISPLAY only. Correctness comes from the deadline stored in session
 * state, so a missed interval, a throttled background timer, or a locked phone
 * cannot desynchronize the countdown — the next render simply reads the wall clock
 * and catches up.
 */
export function useTicker(active: boolean, intervalMs = 250): number {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!active) return;

    setNow(Date.now());
    const interval = setInterval(() => setNow(Date.now()), intervalMs);

    // Returning to the foreground re-reads the clock immediately rather than
    // waiting up to intervalMs, so the timer never appears frozen on resume.
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') setNow(Date.now());
    });

    return () => {
      clearInterval(interval);
      subscription.remove();
    };
  }, [active, intervalMs]);

  return now;
}
