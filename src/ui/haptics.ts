import * as Haptics from 'expo-haptics';

/**
 * Haptics during a workout (PRD §12).
 *
 * The user is mid-exercise and probably not looking at the screen, so a timer
 * reaching zero must be felt. Every call is guarded: haptics are unavailable on web
 * and on some devices, and a missing vibration must never interrupt a workout.
 */
export function tapFeedback(): void {
  void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
}

export function stepCompleteFeedback(): void {
  void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
}

export function timerFinishedFeedback(): void {
  void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {});
}
