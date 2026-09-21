import { describe, expect, it, vi } from 'vitest';
import Anthropic from '@anthropic-ai/sdk';
import { extractWorkoutWithClaude } from './anthropicExtractor';
import { runExtractionPipeline } from '@/core/extraction/pipeline';
import { emptyProcessedMedia, type ProcessedMedia } from '@/core/extraction/service';
import type { WireExtraction } from '@/core/extraction/wire';
import { allExercises } from '@/core/schema/workout';

/**
 * These drive the real extractor with a stubbed SDK client.
 *
 * No live API call is made here — what is under test is everything around the model:
 * the request we build, how we interpret each response shape, how SDK errors map to
 * retryable/non-retryable outcomes, and — most importantly — that a misbehaving
 * model cannot get an invented prescription past the guardrails.
 */

function media(overrides: Partial<ProcessedMedia> = {}): ProcessedMedia {
  return {
    ...emptyProcessedMedia('src_1', { platform: 'upload' }),
    mediaAnalyzed: true,
    transcript: [{ startSeconds: 0, endSeconds: 6, text: 'Three rounds. Ten each side.' }],
    ...overrides,
  };
}

function field<T>(value: T | null, source = 'speech', confidence = 0.92) {
  return { value, source, confidence } as WireExtraction['blocks'][number]['rounds'];
}

function wire(overrides: Partial<WireExtraction> = {}): WireExtraction {
  return {
    workoutDetected: true,
    title: 'Leg Day',
    structure: 'circuit',
    blocks: [
      {
        kind: 'circuit',
        rounds: field(3),
        restBetweenRoundsSeconds: field(60),
        exercises: [
          {
            name: field('Bulgarian Split Squat') as never,
            sets: field(null),
            reps: field(null),
            repsPerSide: field(10),
            durationSeconds: field(null),
            restSeconds: field(null),
            weight: field(null) as never,
            formCues: [field('Keep your torso slightly forward.') as never],
          },
        ],
      },
    ],
    workoutNotes: [],
    detectedMovements: ['Bulgarian Split Squat'],
    ...overrides,
  } as WireExtraction;
}

/** The shape of the request we assert against — only the fields this code sets. */
interface CapturedRequest {
  model: string;
  system: { type: string; text: string; cache_control?: { type: string } }[];
  output_config: { effort?: string; format?: unknown };
  messages: { role: string; content: { type: string; [key: string]: unknown }[] }[];
}

/** A stand-in for the SDK client exposing only what the extractor uses. */
function stubClient(result: {
  parsed_output?: WireExtraction | null;
  stop_reason?: string;
  throws?: unknown;
}) {
  const parse = vi.fn(async (_request: CapturedRequest) => {
    if (result.throws) throw result.throws;
    return {
      parsed_output: result.parsed_output ?? null,
      stop_reason: result.stop_reason ?? 'end_turn',
    };
  });
  return { client: { messages: { parse } } as unknown as Anthropic, parse };
}

/** The request the extractor sent on its first (and only) call. */
function requestFrom(parse: { mock: { calls: [CapturedRequest][] } }): CapturedRequest {
  const call = parse.mock.calls[0];
  if (!call) throw new Error('the extractor never called the model');
  return call[0];
}

describe('extractWorkoutWithClaude', () => {
  it('returns a structured extraction from a well-formed response', async () => {
    const { client } = stubClient({ parsed_output: wire() });
    const outcome = await extractWorkoutWithClaude(media(), { apiKey: 'k', client });

    expect(outcome.status).toBe('ok');
    if (outcome.status !== 'ok') return;
    expect(outcome.result.title).toBe('Leg Day');
    expect(outcome.result.blocks[0]?.rounds?.value).toBe(3);
  });

  it('sends the frozen system prompt as a cacheable block', async () => {
    // The prompt is identical on every import, so it should be paid for once.
    const { client, parse } = stubClient({ parsed_output: wire() });
    await extractWorkoutWithClaude(media(), { apiKey: 'k', client });

    const request = requestFrom(parse);
    expect(request.system[0]?.cache_control).toEqual({ type: 'ephemeral' });
    expect(request.model).toBe('claude-opus-5');
    expect(request.output_config.format).toBeDefined();
  });

  it('sends frames as images, each labelled with its timestamp', async () => {
    const { client, parse } = stubClient({ parsed_output: wire() });
    await extractWorkoutWithClaude(
      media({
        frames: [
          { atSeconds: 2, base64: 'AAAA', mediaType: 'image/jpeg' },
          { atSeconds: 8, base64: 'BBBB', mediaType: 'image/jpeg' },
        ],
      }),
      { apiKey: 'k', client },
    );

    const content = requestFrom(parse).messages[0]!.content;
    const images = content.filter((block) => block.type === 'image');
    expect(images).toHaveLength(2);
    expect(images[0]?.source).toMatchObject({ type: 'base64', media_type: 'image/jpeg', data: 'AAAA' });
    // Timestamps let the model align what it sees with what was said.
    expect(JSON.stringify(content)).toContain('Frame at 8s');
  });

  it('caps how many frames are sent', async () => {
    const { client, parse } = stubClient({ parsed_output: wire() });
    const many = Array.from({ length: 20 }, (_, i) => ({
      atSeconds: i,
      base64: 'AAAA',
      mediaType: 'image/jpeg' as const,
    }));
    await extractWorkoutWithClaude(media({ frames: many }), { apiKey: 'k', client, maxFrames: 5 });

    const content = requestFrom(parse).messages[0]!.content;
    expect(content.filter((block) => block.type === 'image')).toHaveLength(5);
  });

  it('sends the transcript and the numbers the transcriber doubted', async () => {
    // This is the whole path PRD §9 depends on: a shaky number has to survive the
    // trip from the transcriber to the model, or it silently becomes a fact.
    const { client, parse } = stubClient({ parsed_output: wire() });
    await extractWorkoutWithClaude(
      media({
        transcript: [
          { startSeconds: 2, endSeconds: 4, text: 'Twelve reps each side.', confidence: 0.9 },
        ],
        uncertainQuantities: [
          { text: '12', atSeconds: 2, confidence: 0.6, context: '12 reps each side' },
        ],
      }),
      { apiKey: 'k', client },
    );

    const evidence = JSON.stringify(requestFrom(parse).messages[0]!.content);
    expect(evidence).toContain('Twelve reps each side.');
    expect(evidence).toContain('uncertainQuantities');
    expect(evidence).toContain('12 reps each side');
  });

  it('will analyze a silent-but-spoken video with no frames at all', async () => {
    // Audio-only evidence is enough; frames are not a precondition.
    const { client, parse } = stubClient({ parsed_output: wire() });
    const outcome = await extractWorkoutWithClaude(
      media({
        frames: [],
        transcript: [{ startSeconds: 0, endSeconds: 3, text: 'Three rounds of ten.' }],
      }),
      { apiKey: 'k', client },
    );

    expect(outcome.status).toBe('ok');
    expect(parse).toHaveBeenCalledOnce();
  });

  it('never calls the model when there is nothing to analyze', async () => {
    // Asking for a workout with no transcript, text or frames is asking for a
    // hallucination — and paying for it.
    const { client, parse } = stubClient({ parsed_output: wire() });
    const outcome = await extractWorkoutWithClaude(
      emptyProcessedMedia('src_1', { platform: 'instagram' }),
      { apiKey: 'k', client },
    );

    expect(outcome).toMatchObject({ status: 'failed', retryable: false });
    expect(parse).not.toHaveBeenCalled();
  });

  it('reports no workout detected without fabricating one', async () => {
    const { client } = stubClient({
      parsed_output: wire({ workoutDetected: false, detectedMovements: ['Push Up'] }),
    });
    const outcome = await extractWorkoutWithClaude(media(), { apiKey: 'k', client });

    expect(outcome).toMatchObject({ status: 'no_workout_detected' });
    if (outcome.status !== 'no_workout_detected') return;
    expect(outcome.detectedMovements).toEqual(['Push Up']);
  });

  it('handles a refusal as a terminal, non-retryable outcome', async () => {
    const { client } = stubClient({ parsed_output: null, stop_reason: 'refusal' });
    const outcome = await extractWorkoutWithClaude(media(), { apiKey: 'k', client });
    expect(outcome).toMatchObject({ status: 'failed', retryable: false });
  });

  it('handles output that failed to parse', async () => {
    const { client } = stubClient({ parsed_output: null });
    const outcome = await extractWorkoutWithClaude(media(), { apiKey: 'k', client });
    expect(outcome).toMatchObject({ status: 'failed', retryable: true });
  });

  it('maps SDK errors to the right retryability', async () => {
    // retryable drives whether the failure screen offers "Try again", so the
    // distinction has to be real rather than a blanket true.
    const cases: [unknown, boolean][] = [
      [new Anthropic.RateLimitError(429, undefined, 'slow down', new Headers()), true],
      [new Anthropic.AuthenticationError(401, undefined, 'bad key', new Headers()), false],
      [new Anthropic.BadRequestError(400, undefined, 'bad input', new Headers()), false],
      [new Anthropic.InternalServerError(500, undefined, 'boom', new Headers()), true],
      [new Error('something else'), true],
    ];

    for (const [thrown, retryable] of cases) {
      const { client } = stubClient({ throws: thrown });
      const outcome = await extractWorkoutWithClaude(media(), { apiKey: 'k', client });
      expect(outcome.status).toBe('failed');
      if (outcome.status !== 'failed') continue;
      expect(outcome.retryable, String(thrown)).toBe(retryable);
    }
  });

  it('strips an invented prescription even when the model ignores the prompt', async () => {
    // The prompt asks for this; the guardrail guarantees it. This is the test that
    // matters most — it is the product's central promise under adversarial input.
    const misbehaving = wire({
      blocks: [
        {
          kind: 'straight_sets',
          rounds: field(4, 'visual_identification', 0.9),
          restBetweenRoundsSeconds: field(null),
          exercises: [
            {
              name: field('Goblet Squat', 'visual_identification', 0.93) as never,
              sets: field(3, 'visual_identification', 0.85),
              reps: field(10, 'visual_identification', 0.85),
              repsPerSide: field(null),
              durationSeconds: field(null),
              restSeconds: field(60, 'visual_identification', 0.8),
              weight: field(null) as never,
              formCues: [field('Push your knees out as you stand.', 'visual_identification', 0.7) as never],
            },
          ],
        },
      ],
    });

    const { client } = stubClient({ parsed_output: misbehaving });
    const service = {
      id: 'anthropic',
      extractWorkout: () => extractWorkoutWithClaude(media(), { apiKey: 'k', client }),
    };

    const result = await runExtractionPipeline(service, media());
    expect(result.status).toBe('ok');
    if (result.status !== 'ok') return;

    const exercise = allExercises(result.workout)[0]!;
    // The movement name survives — that is the one thing vision may establish.
    expect(exercise.name.value).toBe('Goblet Squat');
    // Everything it claimed to have counted by watching does not.
    expect(exercise.sets?.value ?? null).toBeNull();
    expect(exercise.reps?.value ?? null).toBeNull();
    expect(exercise.restSeconds?.value ?? null).toBeNull();
    expect(result.workout.blocks[0]!.rounds?.value ?? null).toBeNull();
    // And it does not get to write coaching under the creator's name.
    expect(exercise.formCues).toHaveLength(0);
  });

  it('keeps a prescription the model read off the screen', async () => {
    // Text burned into a frame is something the creator wrote, so it is a real
    // source — unlike counting reps by eye.
    const onScreen = wire({
      blocks: [
        {
          kind: 'straight_sets',
          rounds: field(null),
          restBetweenRoundsSeconds: field(null),
          exercises: [
            {
              name: field('Hip Thrust', 'visual_identification', 0.9) as never,
              sets: field(3, 'onscreen_text', 0.94),
              reps: field(15, 'onscreen_text', 0.94),
              repsPerSide: field(null),
              durationSeconds: field(null),
              restSeconds: field(null),
              weight: field(null) as never,
              formCues: [],
            },
          ],
        },
      ],
    });

    const { client } = stubClient({ parsed_output: onScreen });
    const service = {
      id: 'anthropic',
      extractWorkout: () => extractWorkoutWithClaude(media(), { apiKey: 'k', client }),
    };

    const result = await runExtractionPipeline(service, media());
    expect(result.status).toBe('ok');
    if (result.status !== 'ok') return;

    const exercise = allExercises(result.workout)[0]!;
    expect(exercise.sets?.value).toBe(3);
    expect(exercise.reps?.value).toBe(15);
  });
});
