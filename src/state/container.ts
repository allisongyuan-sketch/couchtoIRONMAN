import { asyncStorageKeyValueStore } from '@/data/asyncStorage';
import { createRepositories } from '@/data/repositories';
import { MockExtractionService } from '@/core/extraction/mockService';
import { MockMediaProcessor } from '@/core/extraction/mediaProcessor';
import { DEFAULT_IMPORT_POLICY, type ImportDependencies } from '@/core/import/importWorkout';

/**
 * Composition root.
 *
 * The one place that decides which concrete adapters the app runs with. Everything
 * else depends on interfaces, so switching to a real extraction vendor (Milestone 4)
 * or a Supabase-backed store is a change here and nowhere else.
 */

export const repositories = createRepositories(asyncStorageKeyValueStore);

/**
 * Extraction is mocked today. `MockExtractionService` returns schema-valid fixtures
 * with realistic latency, which is what lets the full import → review → edit → save →
 * execute loop be built and verified with zero credentials configured (PRD §40).
 */
export const importDependencies: ImportDependencies = {
  mediaProcessor: new MockMediaProcessor(),
  extractionService: new MockExtractionService({ latencyMs: 2200 }),
  policy: DEFAULT_IMPORT_POLICY,
};
