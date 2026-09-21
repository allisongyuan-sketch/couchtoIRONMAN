import { handleTranscribeRequest } from '../src/server/transcribeHandler';

/**
 * POST /api/transcribe on Vercel. See `api/extract.ts` — same reasoning.
 */
export function POST(request: Request): Promise<Response> {
  return handleTranscribeRequest(request);
}

export function GET(): Response {
  return Response.json({
    ok: true,
    route: 'transcribe',
    transcriptionConfigured: !!process.env.DEEPGRAM_API_KEY,
  });
}
