import type { TranscriptionService } from '@/core/transcription/types';
import { DeepgramTranscriptionService } from './deepgram';

export * from './deepgram';

/**
 * Pick a transcription provider from the environment.
 *
 * Returns null when none is configured, and that is a supported state: the app
 * degrades to frames-only extraction rather than failing the import. Adding a second
 * provider means one more class and one more branch here — nothing else changes,
 * because everything upstream depends on `TranscriptionService`.
 */
export function createTranscriptionService(
  env: Record<string, string | undefined> = process.env,
): TranscriptionService | null {
  const deepgramKey = env['DEEPGRAM_API_KEY']?.trim();
  if (deepgramKey) {
    const model = env['DEEPGRAM_MODEL']?.trim();
    return new DeepgramTranscriptionService({
      apiKey: deepgramKey,
      ...(model ? { model } : {}),
    });
  }

  return null;
}
