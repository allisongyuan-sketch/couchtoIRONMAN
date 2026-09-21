import { handleExtractRequest } from '../src/server/extractHandler';

/**
 * POST /api/extract on Vercel.
 *
 * A binding, like the Expo Router route it mirrors. The handler takes a web-standard
 * `Request` and returns a `Response`, which is exactly Vercel's function signature —
 * so the same code runs under Expo's server output and here with no adapter.
 *
 * The Anthropic key is read from the environment at request time and never leaves
 * the server.
 */
export function POST(request: Request): Promise<Response> {
  return handleExtractRequest(request);
}

/** A cheap liveness probe, so a deployment can be checked without spending a call. */
export function GET(): Response {
  return Response.json({
    ok: true,
    route: 'extract',
    extractionConfigured: !!process.env.ANTHROPIC_API_KEY,
  });
}
