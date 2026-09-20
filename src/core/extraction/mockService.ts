import { structuredWorkoutExtractionSchema } from '../schema/extraction';
import { FIXTURES, FIXTURE_KEYS, type FixtureKey } from './fixtures';
import type {
  ExtractionOptions,
  ExtractionOutcome,
  ProcessedMedia,
  WorkoutExtractionService,
} from './service';

/**
 * The default extraction service.
 *
 * It implements the real interface, returns real schema-valid data, and takes a
 * realistic amount of time — so the entire import experience, including its failure
 * and low-confidence states, can be built and tested before a model exists.
 *
 * Selection is deterministic from the source URL so that demos and tests are
 * repeatable: the same link always produces the same workout.
 */
export interface MockExtractionOptions {
  /** Always return this fixture, ignoring the URL. Used by tests and the dev menu. */
  forceFixture?: FixtureKey;
  /** Simulated processing latency, in ms. */
  latencyMs?: number;
  /** Force an outcome, to exercise the error states in PRD §31. */
  forceOutcome?: 'no_workout_detected' | 'failed';
}

export class MockExtractionService implements WorkoutExtractionService {
  readonly id = 'mock';

  constructor(private readonly options: MockExtractionOptions = {}) {}

  async extractWorkout(
    media: ProcessedMedia,
    options?: ExtractionOptions,
  ): Promise<ExtractionOutcome> {
    await delay(this.options.latencyMs ?? 0, options?.signal);

    if (options?.signal?.aborted) {
      return { status: 'failed', reason: 'Extraction was cancelled', retryable: true };
    }

    if (this.options.forceOutcome === 'failed') {
      return { status: 'failed', reason: 'The analyzer could not process this video', retryable: true };
    }

    const fixtureKey = this.options.forceFixture ?? pickFixture(media);
    const fixture = FIXTURES[fixtureKey];

    if (this.options.forceOutcome === 'no_workout_detected') {
      return { status: 'no_workout_detected', detectedMovements: fixture.detectedMovements };
    }

    // Validate our own fixture against the schema. If a fixture ever drifts from the
    // contract, the mock fails the same way a real vendor would — which is the point.
    const parsed = structuredWorkoutExtractionSchema.safeParse(fixture);
    if (!parsed.success) {
      return { status: 'failed', reason: 'Extraction did not match the expected schema', retryable: false };
    }

    return { status: 'ok', result: parsed.data };
  }
}

/** Stable hash of the source URL → fixture. Same link, same workout, every time. */
function pickFixture(media: ProcessedMedia): FixtureKey {
  const key = media.source.url ?? media.sourceContentId;
  let hash = 0;
  for (let i = 0; i < key.length; i += 1) {
    hash = (hash * 31 + key.charCodeAt(i)) % 100000;
  }
  return FIXTURE_KEYS[hash % FIXTURE_KEYS.length] ?? 'legDayCircuit';
}

function delay(ms: number, signal?: AbortSignal): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve) => {
    const timeout = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => {
      clearTimeout(timeout);
      resolve();
    });
  });
}
