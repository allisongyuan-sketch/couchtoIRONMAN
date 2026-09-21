import * as VideoThumbnails from 'expo-video-thumbnails';
import { manipulateAsync, SaveFormat } from 'expo-image-manipulator';
import type { IngestionResult } from '../ingestion/types';
import type { MediaFrame, MediaProcessor, ProcessedMedia } from './service';
import { probeTimestamps, sampleTimestamps } from './frameSampling';
import type { TranscriptionClient } from '../transcription/types';
import {
  findUncertainQuantities,
  toTranscriptSegments,
} from '../transcription/uncertainQuantities';

/**
 * The real media-processing stage: sample frames from a video the user gave us.
 *
 * This is what makes real extraction possible without speech recognition. Claude
 * reads the frames, which yields two different kinds of evidence with two different
 * provenances — the movement being demonstrated (`visual_identification`) and any
 * prescription the creator burned into the video (`onscreen_text`). Short-form
 * fitness content puts "3 × 10" on screen constantly, so this alone recovers a lot.
 *
 * It also transcribes the speech, when a transcription client is supplied. Spoken
 * audio is the PRD's highest-priority source (§10), and it is the only one that
 * carries a prescription the creator never wrote down anywhere.
 *
 * Transcription is best-effort by design. A silent video, an unconfigured provider or
 * a transcriber outage all degrade the import to frames-only rather than failing it —
 * a workout with movements and no numbers is a usable result (PRD §8), an error
 * screen is not.
 */

export interface VideoFrameProcessorOptions {
  /** Omit to skip transcription entirely and run on frames alone. */
  transcription?: TranscriptionClient;
  maxFrames?: number;
  /**
   * Frames are resized before upload. 768px keeps burned-in text legible — which is
   * the whole point of reading frames — while keeping one import to roughly 1.5k
   * vision tokens per frame rather than several times that at full resolution.
   */
  maxWidth?: number;
  /** JPEG quality. Text stays readable well below 1.0. */
  compress?: number;
}

const DEFAULTS = { maxFrames: 8, maxWidth: 768, compress: 0.7 } as const;

export class VideoFrameMediaProcessor implements MediaProcessor {
  readonly id = 'video-frame-processor';

  constructor(private readonly options: VideoFrameProcessorOptions = {}) {}

  async process(sourceContentId: string, ingestion: IngestionResult): Promise<ProcessedMedia> {
    const source =
      ingestion.status === 'ok' || ingestion.status === 'metadata_only'
        ? ingestion.source
        : { platform: 'other' as const };

    const media: ProcessedMedia = {
      sourceContentId,
      source,
      mediaAnalyzed: false,
      transcript: [],
      onScreenText: [],
      visualObservations: [],
      frames: [],
      uncertainQuantities: [],
    };

    if (ingestion.status !== 'ok') {
      // Metadata-only content: we still have the caption, which is often the single
      // richest text signal a creator provides.
      if (source.caption) media.captionText = source.caption;
      return media;
    }

    if (ingestion.media.captionText) media.captionText = ingestion.media.captionText;
    if (ingestion.media.durationSeconds !== undefined) {
      media.durationSeconds = ingestion.media.durationSeconds;
    }

    const uri = ingestion.media.mediaUri;
    if (!uri) return media;

    // Both stages run against the same file and neither needs the other's output, so
    // there is no reason to make the user wait for them in sequence.
    const [frames, transcript] = await Promise.all([
      this.sampleFrames(uri, ingestion.media.durationSeconds),
      this.transcribe(uri),
    ]);

    media.frames = frames;
    if (transcript) {
      media.transcript = toTranscriptSegments(transcript.utterances);
      media.uncertainQuantities = findUncertainQuantities(transcript.utterances);
    }

    media.mediaAnalyzed = media.frames.length > 0 || media.transcript.length > 0;
    return media;
  }

  /**
   * Never throws and never rejects the import. Anything that goes wrong here means
   * one fewer evidence source, not a failed conversion.
   */
  private async transcribe(uri: string) {
    const client = this.options.transcription;
    if (!client) return null;

    try {
      const outcome = await client.transcribeFile({ uri, mediaType: 'video/mp4' });
      return outcome.status === 'ok' ? outcome.transcript : null;
    } catch {
      return null;
    }
  }

  private async sampleFrames(uri: string, durationSeconds?: number): Promise<MediaFrame[]> {
    const maxFrames = this.options.maxFrames ?? DEFAULTS.maxFrames;
    const timestamps =
      durationSeconds !== undefined && durationSeconds > 0
        ? sampleTimestamps(durationSeconds, maxFrames)
        : probeTimestamps(maxFrames);

    const frames: MediaFrame[] = [];

    for (const atSeconds of timestamps) {
      try {
        const frame = await this.extractFrame(uri, atSeconds);
        if (frame) frames.push(frame);
      } catch {
        // A failure past the end of the clip is the expected way the unknown-duration
        // probe terminates, so stop rather than grinding through the rest of the
        // ladder. Partial frames are still a usable result.
        break;
      }
    }

    return frames;
  }

  private async extractFrame(uri: string, atSeconds: number): Promise<MediaFrame | null> {
    const thumbnail = await VideoThumbnails.getThumbnailAsync(uri, {
      time: Math.round(atSeconds * 1000),
    });

    const resized = await manipulateAsync(
      thumbnail.uri,
      [{ resize: { width: this.options.maxWidth ?? DEFAULTS.maxWidth } }],
      {
        base64: true,
        compress: this.options.compress ?? DEFAULTS.compress,
        format: SaveFormat.JPEG,
      },
    );

    if (!resized.base64) return null;
    return { atSeconds, base64: resized.base64, mediaType: 'image/jpeg' };
  }
}
