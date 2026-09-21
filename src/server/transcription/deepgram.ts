import type {
  Transcript,
  TranscriptionOptions,
  TranscriptionOutcome,
  TranscriptionService,
  TranscriptUtterance,
  TranscriptWord,
} from '@/core/transcription/types';

/**
 * Deepgram transcription.
 *
 * Runs server-side only, for the same reason the Claude call does: a key in the app
 * bundle is extractable from the shipped binary.
 *
 * Two properties made this the right first provider:
 *
 *   • It accepts an MP4 directly and pulls the audio itself, so the app never has to
 *     demux or re-encode on device — no ffmpeg, no native audio module.
 *   • It returns **per-word confidence**, which is what PRD §9 actually needs. An
 *     overall transcript score cannot tell you that one number in an otherwise clean
 *     sentence was a coin flip.
 */

export interface DeepgramConfig {
  apiKey: string;
  /** Deepgram model name. */
  model?: string;
  endpoint?: string;
  fetchImpl?: typeof fetch;
}

const DEFAULT_ENDPOINT = 'https://api.deepgram.com/v1/listen';
const DEFAULT_MODEL = 'nova-3';

export class DeepgramTranscriptionService implements TranscriptionService {
  readonly id = 'deepgram';

  constructor(private readonly config: DeepgramConfig) {}

  async transcribe(
    media: { bytes: ArrayBuffer; mediaType: string },
    options?: TranscriptionOptions,
  ): Promise<TranscriptionOutcome> {
    if (media.bytes.byteLength === 0) {
      return { status: 'failed', reason: 'The file was empty', retryable: false };
    }

    const url = new URL(this.config.endpoint ?? DEFAULT_ENDPOINT);
    url.searchParams.set('model', this.config.model ?? DEFAULT_MODEL);
    // Utterances give us sentence-level grouping with word detail inside, which is
    // exactly the shape the extraction stage wants.
    url.searchParams.set('utterances', 'true');
    // Numerals as digits ("12" not "twelve") — easier for the model to read, and it
    // keeps the quantity detector from depending on spelled-out forms.
    url.searchParams.set('smart_format', 'true');
    url.searchParams.set('punctuate', 'true');

    const doFetch = this.config.fetchImpl ?? fetch;

    let response: Response;
    try {
      response = await doFetch(url.toString(), {
        method: 'POST',
        headers: {
          authorization: `Token ${this.config.apiKey}`,
          'content-type': media.mediaType,
        },
        body: media.bytes,
        ...(options?.signal ? { signal: options.signal } : {}),
      });
    } catch {
      return { status: 'failed', reason: 'Could not reach the transcriber', retryable: true };
    }

    if (!response.ok) {
      return {
        status: 'failed',
        reason: `The transcriber returned ${response.status}`,
        // 4xx will fail the same way next time; 429 and 5xx are worth another go.
        retryable: response.status >= 500 || response.status === 429,
      };
    }

    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      return { status: 'failed', reason: 'The transcriber returned malformed data', retryable: true };
    }

    const transcript = parseDeepgramResponse(payload);
    if (!transcript) {
      return { status: 'failed', reason: 'The transcriber returned an unexpected shape', retryable: true };
    }

    // A silent demonstration is a perfectly normal video, not a failure. The import
    // continues on frames alone.
    if (transcript.utterances.length === 0 || transcript.text.trim().length === 0) {
      return { status: 'no_speech' };
    }

    return { status: 'ok', transcript };
  }
}

/* ------------------------------------------------------------------ *
 * Response parsing
 *
 * Kept as a standalone pure function so the wire shape can be tested against
 * recorded payloads without a network call.
 * ------------------------------------------------------------------ */

interface DeepgramWord {
  word?: unknown;
  punctuated_word?: unknown;
  start?: unknown;
  end?: unknown;
  confidence?: unknown;
}

export function parseDeepgramResponse(payload: unknown): Transcript | null {
  if (!isRecord(payload)) return null;
  const results = payload['results'];
  if (!isRecord(results)) return null;

  // Structural validity is a separate question from emptiness. A silent video comes
  // back well-formed with nothing in it, and that must read as "no speech" rather
  // than as a broken response — otherwise every wordless demo looks like an outage.
  if (!Array.isArray(results['utterances']) && !Array.isArray(results['channels'])) {
    return null;
  }

  const utterances = parseUtterances(results['utterances']);

  // `utterances=true` is requested, but fall back to the channel alternative so a
  // change in Deepgram's defaults degrades to a usable transcript rather than none.
  const alternative = firstAlternative(results);

  const text =
    utterances.length > 0
      ? utterances.map((utterance) => utterance.text).join(' ').trim()
      : String(alternative?.['transcript'] ?? '').trim();

  const transcript: Transcript = {
    text,
    utterances:
      utterances.length > 0 ? utterances : fallbackUtterance(alternative, text),
    confidence:
      utterances.length > 0
        ? mean(utterances.map((utterance) => utterance.confidence))
        : toNumber(alternative?.['confidence'], 0),
  };

  const language = detectedLanguage(results);
  if (language) transcript.language = language;
  return transcript;
}

function parseUtterances(raw: unknown): TranscriptUtterance[] {
  if (!Array.isArray(raw)) return [];

  return raw.flatMap((entry): TranscriptUtterance[] => {
    if (!isRecord(entry)) return [];
    const text = String(entry['transcript'] ?? '').trim();
    if (!text) return [];

    const words = parseWords(entry['words']);
    return [
      {
        text,
        startSeconds: toNumber(entry['start'], 0),
        endSeconds: toNumber(entry['end'], 0),
        confidence: toNumber(entry['confidence'], words.length ? mean(words.map((w) => w.confidence)) : 0),
        words,
      },
    ];
  });
}

function parseWords(raw: unknown): TranscriptWord[] {
  if (!Array.isArray(raw)) return [];

  return raw.flatMap((entry): TranscriptWord[] => {
    if (!isRecord(entry)) return [];
    const word = entry as DeepgramWord;
    // `punctuated_word` carries smart formatting ("12" rather than "twelve"), so
    // prefer it — the quantity detector reads these strings.
    const text = String(word.punctuated_word ?? word.word ?? '').trim();
    if (!text) return [];

    return [
      {
        text,
        startSeconds: toNumber(word.start, 0),
        endSeconds: toNumber(word.end, 0),
        confidence: toNumber(word.confidence, 0),
      },
    ];
  });
}

function firstAlternative(results: Record<string, unknown>): Record<string, unknown> | null {
  const channels = results['channels'];
  if (!Array.isArray(channels)) return null;
  const channel = channels[0];
  if (!isRecord(channel)) return null;
  const alternatives = channel['alternatives'];
  if (!Array.isArray(alternatives)) return null;
  const alternative = alternatives[0];
  return isRecord(alternative) ? alternative : null;
}

/** One synthetic utterance, so downstream code always sees the same shape. */
function fallbackUtterance(
  alternative: Record<string, unknown> | null,
  text: string,
): TranscriptUtterance[] {
  if (!alternative || !text) return [];
  const words = parseWords(alternative['words']);
  return [
    {
      text,
      startSeconds: words[0]?.startSeconds ?? 0,
      endSeconds: words[words.length - 1]?.endSeconds ?? 0,
      confidence: toNumber(alternative['confidence'], 0),
      words,
    },
  ];
}

function detectedLanguage(results: Record<string, unknown>): string | undefined {
  const channels = results['channels'];
  if (!Array.isArray(channels) || !isRecord(channels[0])) return undefined;
  const language = channels[0]['detected_language'];
  return typeof language === 'string' ? language : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function toNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}
