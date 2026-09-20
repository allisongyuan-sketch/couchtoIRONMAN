import { z } from 'zod';
import { extractWorkoutWithClaude } from './anthropicExtractor';
import type { ProcessedMedia } from '@/core/extraction/service';
import { workoutSourceSchema } from '@/core/schema/workout';

/**
 * The extraction endpoint's request handling.
 *
 * This exists so that the Anthropic API key lives on a server and never in the app
 * bundle. A key shipped to devices can be pulled out of the binary and used to run up
 * a bill against our account; there is no client-side mitigation for that.
 *
 * It lives in `src/server` rather than in the route file for the same reason screens
 * live outside `src/core`: everything under `app/` is a route, so keeping logic here
 * means it can be imported and tested like any other module. `app/api/extract+api.ts`
 * is a two-line binding onto this.
 */

/** Guards against an oversized request before we read it into memory. */
const MAX_BODY_BYTES = 12 * 1024 * 1024;
const MAX_FRAMES = 12;

const frameSchema = z.object({
  atSeconds: z.number().min(0),
  base64: z.string().min(1),
  mediaType: z.enum(['image/jpeg', 'image/png', 'image/webp']),
});

const requestSchema = z.object({
  sourceContentId: z.string().min(1),
  source: workoutSourceSchema,
  mediaAnalyzed: z.boolean(),
  transcript: z
    .array(
      z.object({
        startSeconds: z.number(),
        endSeconds: z.number(),
        text: z.string(),
        confidence: z.number().min(0).max(1).optional(),
      }),
    )
    .default([]),
  onScreenText: z
    .array(
      z.object({
        startSeconds: z.number(),
        endSeconds: z.number(),
        text: z.string(),
        confidence: z.number().min(0).max(1).optional(),
      }),
    )
    .default([]),
  captionText: z.string().optional(),
  frames: z.array(frameSchema).max(MAX_FRAMES).default([]),
  durationSeconds: z.number().min(0).optional(),
});

export async function handleExtractRequest(request: Request): Promise<Response> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    // A misconfigured server is our problem, not the user's, and it is not something
    // retrying will fix. Say so without describing our configuration.
    return json(
      { status: 'failed', reason: 'Automatic import is unavailable right now', retryable: false },
      503,
    );
  }

  const declaredLength = Number(request.headers.get('content-length') ?? '0');
  if (declaredLength > MAX_BODY_BYTES) {
    return json({ status: 'failed', reason: 'That video is too large to analyze', retryable: false }, 413);
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ status: 'failed', reason: 'Malformed request', retryable: false }, 400);
  }

  const parsed = requestSchema.safeParse(body);
  if (!parsed.success) {
    return json({ status: 'failed', reason: 'Malformed request', retryable: false }, 400);
  }

  const media: ProcessedMedia = {
    ...parsed.data,
    // The client cannot assert this — it is derived from what actually arrived.
    mediaAnalyzed: parsed.data.frames.length > 0 || parsed.data.transcript.length > 0,
    visualObservations: [],
  };

  const outcome = await extractWorkoutWithClaude(media, {
    apiKey,
    ...(process.env.EXTRACTION_MODEL ? { model: process.env.EXTRACTION_MODEL } : {}),
  });

  // Every outcome — including failure — is a 200 with a typed body. The client
  // branches on `status`, and an extraction that found no workout is a product
  // state, not an HTTP error.
  return json(outcome, 200);
}

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}
