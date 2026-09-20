import { describe, expect, it, vi } from 'vitest';
import { LLMExtractionService } from './llmService';
import { runExtractionPipeline } from './pipeline';
import { emptyProcessedMedia, type ProcessedMedia } from './service';
import { extracted } from '../schema/provenance';

/**
 * Proves the vendor seam: a real service implementation drops into the same pipeline
 * as the mock, and the guardrails apply to its output exactly as they do to any other.
 */

function mediaWithTranscript(): ProcessedMedia {
  return {
    ...emptyProcessedMedia('src_1', { platform: 'tiktok' }),
    mediaAnalyzed: true,
    transcript: [{ startSeconds: 0, endSeconds: 8, text: 'Three rounds. Ten squats.' }],
  };
}

function serviceReturning(payload: unknown, status = 200) {
  const fetchImpl = vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: async () => payload,
  } as Response);

  return {
    fetchImpl,
    service: new LLMExtractionService({
      apiKey: 'test-key',
      model: 'test-model',
      endpoint: 'https://example.invalid/extract',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    }),
  };
}

describe('LLMExtractionService', () => {
  it('validates and returns a well-formed extraction', async () => {
    const { service, fetchImpl } = serviceReturning({
      output: {
        title: 'Quick Legs',
        structure: 'circuit',
        blocks: [
          {
            kind: 'circuit',
            rounds: extracted(3, 'speech', 0.9),
            exercises: [{ name: extracted('Squat', 'speech', 0.9), reps: extracted(10, 'speech', 0.9), formCues: [], notes: [] }],
          },
        ],
        workoutNotes: [],
        detectedMovements: ['Squat'],
      },
    });

    const outcome = await service.extractWorkout(mediaWithTranscript());
    expect(outcome.status).toBe('ok');
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it('guards a vendor that invents a prescription from what it saw', async () => {
    // The whole reason guardrails are code and not just prompt text.
    const { service } = serviceReturning({
      title: 'Silent Demo',
      structure: 'straight_sets',
      blocks: [
        {
          kind: 'straight_sets',
          exercises: [
            {
              name: extracted('Goblet Squat', 'visual_identification', 0.9),
              sets: extracted(3, 'visual_identification', 0.8),
              reps: extracted(10, 'visual_identification', 0.8),
              formCues: [extracted('Go slow on the way down.', 'visual_identification', 0.7)],
              notes: [],
            },
          ],
        },
      ],
      workoutNotes: [],
      detectedMovements: ['Goblet Squat'],
    });

    const result = await runExtractionPipeline(service, mediaWithTranscript());
    expect(result.status).toBe('ok');
    if (result.status !== 'ok') return;

    const exercise = result.workout.blocks[0]!.exercises[0]!;
    // The name survives; the invented prescription and the invented cue do not.
    expect(exercise.name.value).toBe('Goblet Squat');
    expect(exercise.sets?.value ?? null).toBeNull();
    expect(exercise.reps?.value ?? null).toBeNull();
    expect(exercise.formCues).toHaveLength(0);
    expect(result.extraction.guardrailActions.length).toBeGreaterThan(0);
  });

  it('refuses to analyze when there is nothing to analyze', async () => {
    const { service, fetchImpl } = serviceReturning({});
    const outcome = await service.extractWorkout(
      emptyProcessedMedia('src_1', { platform: 'instagram' }),
    );

    expect(outcome.status).toBe('failed');
    // No request was made — we did not ask a model to invent from nothing.
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('marks server errors retryable and client errors not', async () => {
    const server = serviceReturning({}, 503);
    const serverOutcome = await server.service.extractWorkout(mediaWithTranscript());
    expect(serverOutcome).toMatchObject({ status: 'failed', retryable: true });

    const client = serviceReturning({}, 400);
    const clientOutcome = await client.service.extractWorkout(mediaWithTranscript());
    expect(clientOutcome).toMatchObject({ status: 'failed', retryable: false });
  });

  it('reports malformed vendor output rather than passing it downstream', async () => {
    const { service } = serviceReturning({ output: { title: 'Broken' } });
    const outcome = await service.extractWorkout(mediaWithTranscript());
    expect(outcome).toMatchObject({ status: 'failed', retryable: true });
  });

  it('surfaces a network failure as retryable', async () => {
    const service = new LLMExtractionService({
      apiKey: 'k',
      model: 'm',
      endpoint: 'https://example.invalid/extract',
      fetchImpl: (() => Promise.reject(new Error('network down'))) as unknown as typeof fetch,
    });

    const outcome = await service.extractWorkout(mediaWithTranscript());
    expect(outcome).toMatchObject({ status: 'failed', reason: 'network down', retryable: true });
  });
});
