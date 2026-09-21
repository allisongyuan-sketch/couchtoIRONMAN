/**
 * Where to sample frames from a video.
 *
 * Pure so the sampling strategy can be reasoned about and tested without a device.
 */

/**
 * Evenly spaced timestamps across a clip of known length.
 *
 * The first and last moments are skipped deliberately: short-form video almost
 * always opens and closes on a title card or an outro, neither of which shows a
 * movement being performed.
 */
export function sampleTimestamps(durationSeconds: number, count: number): number[] {
  if (durationSeconds <= 0 || count <= 0) return [];
  if (count === 1) return [durationSeconds / 2];

  const usableStart = durationSeconds * 0.05;
  const usableEnd = durationSeconds * 0.95;
  const span = usableEnd - usableStart;
  const step = span / (count - 1);

  return Array.from({ length: count }, (_, index) =>
    Number((usableStart + step * index).toFixed(3)),
  );
}

/**
 * Timestamps to try when the duration is unknown.
 *
 * An uploaded file does not necessarily tell us how long it is, and short-form video
 * is short, so probing a fixed ladder and stopping at the first failure costs little
 * and avoids pulling in a media-metadata dependency just to read one number.
 */
export function probeTimestamps(count: number): number[] {
  const ladder = [0.5, 2, 4, 7, 10, 14, 18, 23, 28, 34, 40, 50];
  return ladder.slice(0, count);
}
