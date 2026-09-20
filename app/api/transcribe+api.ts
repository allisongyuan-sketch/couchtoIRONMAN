import { handleTranscribeRequest } from '@/server/transcribeHandler';

/**
 * POST /api/transcribe — takes a video or audio file, returns a transcript with
 * per-word confidence.
 *
 * A binding and nothing more; the handler lives in `src/server` where it can be
 * imported and tested, since everything under `app/` is a route.
 */
export async function POST(request: Request): Promise<Response> {
  return handleTranscribeRequest(request);
}
