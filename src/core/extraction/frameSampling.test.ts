import { describe, expect, it } from 'vitest';
import { probeTimestamps, sampleTimestamps } from './frameSampling';

describe('frame sampling', () => {
  it('spreads samples across the clip without hitting the very ends', () => {
    const times = sampleTimestamps(30, 5);
    expect(times).toHaveLength(5);
    // Titles and outros live at the extremes; movements do not.
    expect(times[0]).toBeGreaterThan(0);
    expect(times[times.length - 1]).toBeLessThan(30);
    expect([...times].sort((a, b) => a - b)).toEqual(times);
  });

  it('samples the midpoint when only one frame is wanted', () => {
    expect(sampleTimestamps(20, 1)).toEqual([10]);
  });

  it('returns nothing for a degenerate clip', () => {
    expect(sampleTimestamps(0, 8)).toEqual([]);
    expect(sampleTimestamps(30, 0)).toEqual([]);
  });

  it('offers a bounded ladder when the duration is unknown', () => {
    const probes = probeTimestamps(8);
    expect(probes).toHaveLength(8);
    expect([...probes].sort((a, b) => a - b)).toEqual(probes);
    expect(probes[0]).toBeGreaterThan(0);
  });
});
