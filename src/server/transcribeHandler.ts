import { createTranscriptionService } from './transcription';
import type { TranscriptionService } from '@/core/transcription/types';

/**
 * The transcription endpoint's request handling.
 *
 * Separate from `/api/extract` on purpose: this one carries media bytes rather than
 * JSON, talks to a different vendor, and fails differently. Keeping them apart means
 * a transcription outage degrades imports instead of stopping them.
 *
 * Lives in `src/server` rather than the route file because everything under `app/`
 * is a route; `app/api/transcribe+api.ts` is a binding onto this.
 */

/**
 * Short-form video is short. 40MB comfortably covers a minute of phone-shot 1080p
 * while keeping one request from pinning a server's memory.
 */
const MAX_BYTES = 40 * 1024 * 1024;

const ACCEPTED_TYPES = [
  'video/mp4',
  'video/quicktime',
  'video/webm',
  'audio/mp4',
  'audio/mpeg',
  'audio/m4a',
  'audio/x-m4a',
  'audio/wav',
  'audio/webm',
];

export async function handleTranscribeRequest(
  request: Request,
  service: TranscriptionService | null = createTranscriptionService(),
): Promise<Response> {
  if (!service) {
    // Not an error the user can act on, and not one retrying fixes. The client
    // treats this as "no transcript available" and carries on with frames.
    return json({ status: 'failed', reason: 'Transcription is not configured', retryable: false }, 503);
  }

  const declaredLength = Number(request.headers.get('content-length') ?? '0');
  if (declaredLength > MAX_BYTES) {
    return json({ status: 'failed', reason: 'That video is too large to transcribe', retryable: false }, 413);
  }

  let file: UploadedFile | null = null;
  try {
    // The project's TypeScript lib is React Native's, whose `FormData` has no `get`.
    // This handler runs on the server against the standard one, so read it through a
    // structural type rather than making the app-wide lib config lie about itself.
    const form = (await request.formData()) as unknown as {
      get(name: string): unknown;
    };
    file = asUploadedFile(form.get('file'));
  } catch {
    return json({ status: 'failed', reason: 'Malformed request', retryable: false }, 400);
  }

  if (!file) {
    return json({ status: 'failed', reason: 'No file was provided', retryable: false }, 400);
  }

  if (file.size === 0) {
    return json({ status: 'failed', reason: 'The file was empty', retryable: false }, 400);
  }

  if (file.size > MAX_BYTES) {
    return json({ status: 'failed', reason: 'That video is too large to transcribe', retryable: false }, 413);
  }

  const mediaType = normalizeMediaType(file.type);
  if (!mediaType) {
    return json({ status: 'failed', reason: 'That file type cannot be transcribed', retryable: false }, 415);
  }

  const outcome = await service.transcribe({ bytes: await file.arrayBuffer(), mediaType });

  // Every outcome is a 200 with a typed body, including failure — the client
  // branches on `status`, and "no speech" is a normal result, not an HTTP error.
  return json(outcome, 200);
}

/** The parts of an uploaded file this handler actually uses. */
interface UploadedFile {
  size: number;
  type: string;
  arrayBuffer(): Promise<ArrayBuffer>;
}

function asUploadedFile(value: unknown): UploadedFile | null {
  if (!value || typeof value !== 'object') return null;
  const candidate = value as Partial<UploadedFile>;
  if (typeof candidate.arrayBuffer !== 'function') return null;
  if (typeof candidate.size !== 'number') return null;
  return {
    size: candidate.size,
    type: typeof candidate.type === 'string' ? candidate.type : '',
    arrayBuffer: candidate.arrayBuffer.bind(value) as () => Promise<ArrayBuffer>,
  };
}

/**
 * Normalise what the client claimed the file is.
 *
 * Three real cases to absorb: a codec parameter (`video/mp4; codecs=avc1`), an empty
 * type, and `application/octet-stream` — which is what multipart encoding substitutes
 * when the client sends no type, so it reaches us far more often than an empty string
 * does. All three mean "a video the picker gave us", which is virtually always mp4.
 */
const UNSPECIFIED_TYPES = ['', 'application/octet-stream'];

function normalizeMediaType(raw: string): string | null {
  const base = raw.split(';')[0]?.trim().toLowerCase() ?? '';
  if (UNSPECIFIED_TYPES.includes(base)) return 'video/mp4';
  return ACCEPTED_TYPES.includes(base) ? base : null;
}

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}
