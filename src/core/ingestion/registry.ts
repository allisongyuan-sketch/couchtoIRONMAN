import type { ContentIngestionProvider, IngestionInput, IngestionResult } from './types';
import { DEFAULT_PROVIDERS } from './providers';

/**
 * Chooses a provider for an input. The import flow talks to this and nothing else,
 * so the set of supported platforms is a registration detail rather than a branch
 * in a screen.
 */
export class IngestionRegistry {
  private readonly providers: ContentIngestionProvider[];

  constructor(providers: ContentIngestionProvider[] = DEFAULT_PROVIDERS) {
    this.providers = providers;
  }

  register(provider: ContentIngestionProvider): void {
    this.providers.unshift(provider);
  }

  findForUrl(url: string): ContentIngestionProvider | undefined {
    return this.providers.find((provider) => provider.canHandle(url));
  }

  byId(id: string): ContentIngestionProvider | undefined {
    return this.providers.find((provider) => provider.id === id);
  }

  async ingest(input: IngestionInput): Promise<IngestionResult> {
    if (input.localFileUri) {
      const upload = this.byId('upload');
      if (upload) return upload.ingest(input);
    }

    if (input.url) {
      const provider = this.findForUrl(input.url);
      if (!provider) return { status: 'unsupported_source', url: input.url };
      try {
        return await provider.ingest(input);
      } catch (error) {
        return {
          status: 'failed',
          reason: error instanceof Error ? error.message : 'Ingestion failed',
          retryable: true,
        };
      }
    }

    return { status: 'failed', reason: 'Nothing to import', retryable: false };
  }
}

export const ingestionRegistry = new IngestionRegistry();
