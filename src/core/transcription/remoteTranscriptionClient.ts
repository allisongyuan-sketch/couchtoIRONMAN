import type {
  TranscriptionClient,
  TranscriptionOptions,
  TranscriptionOutcome,
} from './types';

/**
 * Sends a local video file to our transcription endpoint.
 *
 * Uses multipart `FormData` with React Native's `{ uri, name, type }` file shape,
 * which streams the file from disk rather than reading it into JavaScript memory.
 * That matters: a minute of phone video is tens of megabytes, and base64-encoding it
 * into a JSON body would both inflate it by a third and risk an out-of-memory crash
 * on a mid-range device.
 *
 * As everywhere else, the device holds a URL and never a credential.
 */

export interface RemoteTranscriptionConfig {
  endpoint: string;
  /**
   * Transcription is a network round trip over a large upload, so this is generous —
   * but not unbounded, because a hung request would strand the import.
   */
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
  /** Injected in tests; React Native supplies its own FormData at runtime. */
  formDataImpl?: () => FormData;
}

const DEFAULT_TIMEOUT_MS = 120_000;

export class RemoteTranscriptionClient implements TranscriptionClient {
  readonly id = 'remote';

  constructor(private readonly config: RemoteTranscriptionConfig) {}

  async transcribeFile(
    file: { uri: string; mediaType: string },
    options?: TranscriptionOptions,
  ): Promise<TranscriptionOutcome> {
    const doFetch = this.config.fetchImpl ?? fetch;
    const makeFormData = this.config.formDataImpl ?? (() => new FormData());

    const form = makeFormData();
    // React Native accepts this object in place of a Blob and streams the file.
    form.append('file', {
      uri: file.uri,
      name: fileNameFor(file.mediaType),
      type: file.mediaType,
    } as unknown as Blob);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.config.timeoutMs ?? DEFAULT_TIMEOUT_MS);
    const abortFromCaller = () => controller.abort();
    options?.signal?.addEventListener('abort', abortFromCaller);

    try {
      const response = await doFetch(this.config.endpoint, {
        method: 'POST',
        // Content-Type is deliberately unset: the runtime has to add the multipart
        // boundary, and setting it by hand produces an unparseable body.
        body: form,
        signal: controller.signal,
      });

      if (!response.ok) {
        return {
          status: 'failed',
          reason:
            response.status === 413
              ? 'That video is too large to transcribe'
              : 'The transcriber could not process this video',
          retryable: response.status >= 500 || response.status === 429,
        };
      }

      const outcome: unknown = await response.json();
      return isTranscriptionOutcome(outcome)
        ? outcome
        : { status: 'failed', reason: 'The transcriber returned an unexpected shape', retryable: true };
    } catch {
      if (options?.signal?.aborted) {
        return { status: 'failed', reason: 'Transcription was cancelled', retryable: true };
      }
      return { status: 'failed', reason: 'Could not reach the transcriber', retryable: true };
    } finally {
      clearTimeout(timeout);
      options?.signal?.removeEventListener('abort', abortFromCaller);
    }
  }
}

function fileNameFor(mediaType: string): string {
  const extension = mediaType.split('/')[1]?.split(';')[0] ?? 'mp4';
  return `upload.${extension === 'quicktime' ? 'mov' : extension}`;
}

function isTranscriptionOutcome(value: unknown): value is TranscriptionOutcome {
  if (!value || typeof value !== 'object') return false;
  const status = (value as { status?: unknown }).status;
  return status === 'ok' || status === 'no_speech' || status === 'failed';
}
