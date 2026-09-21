import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import {
  buildEvidence,
  describeGaps,
  EXTRACTION_SYSTEM_PROMPT,
  hasAnalyzableEvidence,
} from '@/core/extraction/prompt';
import type { ExtractionOutcome, ProcessedMedia } from '@/core/extraction/service';
import {
  isNoWorkoutDetected,
  toStructuredExtraction,
  wireExtractionSchema,
} from '@/core/extraction/wire';

/**
 * The real extraction service.
 *
 * This runs SERVER-SIDE ONLY, and that is not a preference — it is the reason the
 * whole remote/route split exists. An API key shipped in a React Native bundle is
 * extractable from the app binary by anyone who downloads it; there is no
 * obfuscation that fixes this and no `EXPO_PUBLIC_` variable that is safe to use for
 * a credential. The device calls our endpoint; our endpoint calls Anthropic.
 *
 * Nothing in `src/core` or `app/` imports this file. The app talks to
 * `RemoteExtractionService`, which implements the same `WorkoutExtractionService`
 * interface — so from the application's point of view nothing has changed since the
 * mock.
 */

/** Everything below is model-facing configuration, not product behaviour. */
export interface AnthropicExtractorConfig {
  apiKey: string;
  /** Defaults to Claude Opus 5. */
  model?: string;
  /**
   * How hard the model should think. Extraction is a judgement task — distinguishing
   * a stated prescription from a demonstrated one, and recognising circuit structure
   * — so this is not somewhere to economise by default.
   */
  effort?: 'low' | 'medium' | 'high' | 'xhigh' | 'max';
  maxFrames?: number;
  client?: Anthropic;
}

const DEFAULT_MODEL = 'claude-opus-5';

/**
 * Frames dominate request size and cost. Eight stills across a 30–60 second clip is
 * enough to see each movement and catch most on-screen text, without turning one
 * import into a megabyte-scale request.
 */
const DEFAULT_MAX_FRAMES = 8;

export async function extractWorkoutWithClaude(
  media: ProcessedMedia,
  config: AnthropicExtractorConfig,
): Promise<ExtractionOutcome> {
  if (!hasAnalyzableEvidence(media)) {
    // Refuse before spending a request. Asking a model to produce a workout from a
    // URL alone is asking it to hallucinate one.
    return {
      status: 'failed',
      reason: 'There was not enough of this video to analyze',
      retryable: false,
    };
  }

  const client = config.client ?? new Anthropic({ apiKey: config.apiKey });
  const model = config.model ?? DEFAULT_MODEL;
  const frames = media.frames.slice(0, config.maxFrames ?? DEFAULT_MAX_FRAMES);

  try {
    const response = await client.messages.parse({
      model,
      max_tokens: 16000,
      // Adaptive thinking is on by default for Opus 5; naming it is explicit about
      // wanting the model to reason before committing to a structure.
      thinking: { type: 'adaptive' },
      output_config: {
        effort: config.effort ?? 'high',
        format: zodOutputFormat(wireExtractionSchema),
      },
      // The system prompt is identical on every request, so caching it means we pay
      // for those tokens once rather than once per import.
      system: [
        {
          type: 'text',
          text: EXTRACTION_SYSTEM_PROMPT,
          cache_control: { type: 'ephemeral' },
        },
      ],
      messages: [{ role: 'user', content: buildUserContent(media, frames) }],
    });

    if (response.stop_reason === 'refusal') {
      return {
        status: 'failed',
        reason: 'The analyzer declined to process this video',
        retryable: false,
      };
    }

    const parsed = response.parsed_output;
    if (!parsed) {
      return {
        status: 'failed',
        reason: 'The analyzer returned data in an unexpected shape',
        retryable: true,
      };
    }

    if (isNoWorkoutDetected(parsed)) {
      return { status: 'no_workout_detected', detectedMovements: parsed.detectedMovements };
    }

    return { status: 'ok', result: toStructuredExtraction(parsed) };
  } catch (error) {
    return toFailure(error);
  }
}

/**
 * Evidence first, frames last.
 *
 * Text comes before images so the creator's own words anchor the reading before the
 * model starts interpreting bodies — which matches the PRD's source priority, where
 * visual identification ranks last and answers only "what movement is this?".
 */
function buildUserContent(
  media: ProcessedMedia,
  frames: ProcessedMedia['frames'],
): Anthropic.ContentBlockParam[] {
  const content: Anthropic.ContentBlockParam[] = [
    {
      type: 'text',
      text: `Evidence gathered from this video:\n\n${JSON.stringify(buildEvidence(media), null, 2)}`,
    },
  ];

  const gaps = describeGaps(media);
  if (gaps) content.push({ type: 'text', text: gaps });

  for (const frame of frames) {
    // Label each frame with its timestamp so the model can align what it sees with
    // what was said, rather than treating the stills as an unordered set.
    content.push({ type: 'text', text: `Frame at ${frame.atSeconds}s:` });
    content.push({
      type: 'image',
      source: { type: 'base64', media_type: frame.mediaType, data: frame.base64 },
    });
  }

  content.push({
    type: 'text',
    text: 'Extract the workout. Leave unstated values null rather than filling them in.',
  });

  return content;
}

/**
 * Map SDK errors onto the outcome the import flow understands.
 *
 * `retryable` drives whether the failure screen offers "Try again", so the
 * distinction has to be real: a 400 will fail identically next time, a 429 or a 503
 * will not.
 */
function toFailure(error: unknown): ExtractionOutcome {
  if (error instanceof Anthropic.AuthenticationError) {
    return { status: 'failed', reason: 'The analyzer is not configured correctly', retryable: false };
  }
  if (error instanceof Anthropic.RateLimitError) {
    return { status: 'failed', reason: 'The analyzer is busy right now', retryable: true };
  }
  if (error instanceof Anthropic.BadRequestError) {
    return { status: 'failed', reason: 'This video could not be analyzed', retryable: false };
  }
  if (error instanceof Anthropic.APIConnectionError) {
    return { status: 'failed', reason: 'Could not reach the analyzer', retryable: true };
  }
  if (error instanceof Anthropic.APIError) {
    return {
      status: 'failed',
      reason: 'The analyzer failed to process this video',
      retryable: (error.status ?? 500) >= 500,
    };
  }
  return { status: 'failed', reason: 'The analyzer failed unexpectedly', retryable: true };
}
