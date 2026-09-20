import { describe, expect, it } from 'vitest';
import {
  REVIEW_CONFIDENCE_THRESHOLD,
  extracted,
  fieldStatus,
  notSpecified,
  userField,
  wasCorrectedByUser,
} from './provenance';

describe('provenance', () => {
  it('flags low-confidence values for review rather than asserting them', () => {
    const shaky = extracted(12, 'speech', 0.61);
    expect(shaky.needsReview).toBe(true);
    expect(fieldStatus(shaky)).toBe('unclear');

    const confident = extracted(12, 'speech', 0.95);
    expect(confident.needsReview).toBe(false);
    expect(fieldStatus(confident)).toBe('specified');
  });

  it('treats the threshold as exclusive at the boundary', () => {
    expect(extracted(1, 'speech', REVIEW_CONFIDENCE_THRESHOLD).needsReview).toBe(false);
    expect(extracted(1, 'speech', REVIEW_CONFIDENCE_THRESHOLD - 0.001).needsReview).toBe(true);
  });

  it('reports missing information as not specified, never as a default', () => {
    const missing = notSpecified<number>();
    expect(missing.value).toBeNull();
    expect(fieldStatus(missing)).toBe('not_specified');
  });

  it('preserves the creator value when a user overrides it', () => {
    const creator = extracted(10, 'speech', 0.93);
    const corrected = userField(8, creator);

    expect(corrected.value).toBe(8);
    expect(corrected.source).toBe('user');
    expect(corrected.supersedes?.value).toBe(10);
    expect(corrected.supersedes?.source).toBe('speech');
    expect(wasCorrectedByUser(corrected)).toBe(true);
  });

  it('keeps the ORIGINAL creator value across repeated user edits', () => {
    const creator = extracted(10, 'speech', 0.93);
    const once = userField(8, creator);
    const twice = userField(6, once);

    // Still 10 — not 8. Otherwise the edit-rate metric would decay to noise
    // and the creator's actual prescription would be lost after a second tap.
    expect(twice.supersedes?.value).toBe(10);
  });

  it('does not record a supersede when the user sets a value that was never extracted', () => {
    const fresh = userField(12, undefined);
    expect(fresh.supersedes).toBeUndefined();
    expect(wasCorrectedByUser(fresh)).toBe(false);
  });
});
