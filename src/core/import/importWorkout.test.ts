import { describe, expect, it } from 'vitest';
import { importWorkout } from './importWorkout';
import { MockExtractionService } from '../extraction/mockService';
import { allExercises } from '../schema/workout';

/**
 * The failure states in PRD §31 are product features, not afterthoughts.
 * Each one is asserted here so they cannot quietly regress into a generic error.
 */
describe('importWorkout', () => {
  it('imports a supported link into a structured workout', async () => {
    const outcome = await importWorkout(
      { url: 'https://www.tiktok.com/@coachlena/video/7311122334455' },
      { extractionService: new MockExtractionService({ forceFixture: 'legDayCircuit' }) },
    );

    expect(outcome.status).toBe('ok');
    if (outcome.status !== 'ok') return;
    expect(allExercises(outcome.workout)).toHaveLength(3);
    // Attribution survives conversion (PRD §33).
    expect(outcome.workout.source.url).toContain('tiktok.com');
    expect(outcome.workout.source.creatorHandle).toBe('@coachlena');
    // And the workout points back at the extraction that produced it.
    expect(outcome.workout.extractionId).toBe(outcome.extraction.id);
  });

  it('reports an unsupported source without pretending to try', async () => {
    const outcome = await importWorkout({ url: 'https://example.com/video' });
    expect(outcome.status).toBe('failed');
    if (outcome.status !== 'failed') return;
    expect(outcome.failure.kind).toBe('unsupported_url');
    expect(outcome.failure.retryable).toBe(false);
  });

  it('keeps attribution when media is inaccessible, and offers a way forward', async () => {
    // This is the real-world posture once mocks are replaced: we hold the link and
    // the creator, but not the video.
    const outcome = await importWorkout(
      { url: 'https://www.instagram.com/mobilitycoach/reel/Cx1y2z3/' },
      { policy: { analyzeMetadataOnlyContent: false } },
    );

    expect(outcome.status).toBe('failed');
    if (outcome.status !== 'failed') return;
    expect(outcome.failure.kind).toBe('media_inaccessible');
    expect(outcome.failure.source?.creatorHandle).toBe('@mobilitycoach');
    expect(outcome.failure.source?.url).toContain('instagram.com');
  });

  it('shows what it saw when no structured workout could be identified', async () => {
    const outcome = await importWorkout(
      { url: 'https://www.tiktok.com/@x/video/1' },
      {
        extractionService: new MockExtractionService({
          forceFixture: 'hipMobilityFlow',
          forceOutcome: 'no_workout_detected',
        }),
      },
    );

    expect(outcome.status).toBe('failed');
    if (outcome.status !== 'failed') return;
    expect(outcome.failure.kind).toBe('no_workout_detected');
    expect(outcome.failure.detectedMovements).toContain('90/90 Hip Rotation');
  });

  it('marks a processing failure as retryable so the user need not start over', async () => {
    const outcome = await importWorkout(
      { url: 'https://www.tiktok.com/@x/video/1' },
      { extractionService: new MockExtractionService({ forceOutcome: 'failed' }) },
    );

    expect(outcome.status).toBe('failed');
    if (outcome.status !== 'failed') return;
    expect(outcome.failure.kind).toBe('processing_failed');
    expect(outcome.failure.retryable).toBe(true);
  });

  it('creates a workout even when nothing was prescribed', async () => {
    // PRD §8: missing information must never prevent creation of a workout.
    const outcome = await importWorkout(
      { url: 'https://www.tiktok.com/@x/video/1' },
      { extractionService: new MockExtractionService({ forceFixture: 'hipMobilityFlow' }) },
    );

    expect(outcome.status).toBe('ok');
    if (outcome.status !== 'ok') return;
    const exercises = allExercises(outcome.workout);
    expect(exercises).toHaveLength(4);
    for (const exercise of exercises) {
      expect(exercise.reps?.value ?? null).toBeNull();
      expect(exercise.durationSeconds?.value ?? null).toBeNull();
    }
  });

  it('imports an uploaded file through the same pipeline', async () => {
    const outcome = await importWorkout(
      { localFileUri: 'file:///tmp/leg-day.mp4' },
      { extractionService: new MockExtractionService({ forceFixture: 'legDayCircuit' }) },
    );

    expect(outcome.status).toBe('ok');
    if (outcome.status !== 'ok') return;
    expect(outcome.workout.source.platform).toBe('upload');
  });
});
