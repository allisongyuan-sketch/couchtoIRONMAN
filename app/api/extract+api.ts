import { handleExtractRequest } from '@/server/extractHandler';

/**
 * POST /api/extract — the endpoint the app posts video evidence to.
 *
 * Deliberately a binding and nothing more. Everything under `app/` is a route, so
 * the handler itself lives in `src/server` where it can be imported and tested.
 *
 * Serving this from this repo is the reference implementation; a team with an
 * existing backend can serve the same contract from there and point
 * `EXPO_PUBLIC_EXTRACTION_ENDPOINT` at it. The client only ever knows a URL.
 */
export const POST = handleExtractRequest;
