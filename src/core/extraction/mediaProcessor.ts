import type { IngestionResult } from '../ingestion/types';
import type { WorkoutSource } from '../schema/workout';
import type { MediaProcessor, ProcessedMedia } from './service';

/**
 * Stands in for the real media-processing stage: audio extraction → speech-to-text →
 * on-screen text extraction → visual exercise identification → temporal alignment
 * (PRD §20). Each of those needs credentials and real infrastructure; all of them sit
 * behind this one interface.
 *
 * The mock produces an empty-but-valid ProcessedMedia. That is enough, because the
 * mock extraction service downstream works from fixtures — the two mocks together
 * stand in for the whole AI stage, and the seam between them is the real one.
 */
export class MockMediaProcessor implements MediaProcessor {
  readonly id = 'mock-media-processor';

  async process(sourceContentId: string, ingestion: IngestionResult): Promise<ProcessedMedia> {
    const source = extractSource(ingestion);
    return {
      sourceContentId,
      source,
      // True because this stage is *mocked*, not because media was really downloaded.
      // Whether metadata-only content should reach extraction at all is an import
      // policy decision, made in core/import — not silently assumed here.
      mediaAnalyzed: true,
      transcript: [],
      onScreenText: [],
      visualObservations: [],
      frames: [],
      ...(ingestion.status === 'ok' && ingestion.media.captionText
        ? { captionText: ingestion.media.captionText }
        : {}),
    };
  }
}

function extractSource(ingestion: IngestionResult): WorkoutSource {
  if (ingestion.status === 'ok' || ingestion.status === 'metadata_only') return ingestion.source;
  return { platform: 'other' };
}
