import { create } from 'zustand';
import { importWorkout, type ImportFailure } from '@/core/import/importWorkout';
import type { IngestionInput } from '@/core/ingestion/types';
import { parseSourceUrl } from '@/core/ingestion/urls';
import { track } from '@/core/analytics';
import { entitlements } from '@/core/entitlements';
import { importDependencies, repositories } from './container';
import { useDraftStore } from './draftStore';

/**
 * Progress labels shown while importing (PRD §5).
 *
 * These rotate on a timer and are NOT tied to real pipeline progress, because the
 * pipeline cannot report meaningful percentages. The PRD is explicit: do not imply
 * precision the system does not have. So the UI shows an indeterminate indicator with
 * honest descriptions of what the system is broadly doing — never a percentage.
 */
export const PROGRESS_LABELS = [
  'Reading video',
  'Detecting exercises',
  'Extracting sets & reps',
  'Organizing workout',
  'Almost ready',
] as const;

export type ImportEntryPoint = 'share_sheet' | 'paste_link' | 'upload' | 'manual';

type ImportStatus = 'idle' | 'processing' | 'ready' | 'failed';

interface ImportState {
  status: ImportStatus;
  input: IngestionInput | null;
  entryPoint: ImportEntryPoint;
  failure: ImportFailure | null;
  startedAt: number | null;

  start: (input: IngestionInput, entryPoint: ImportEntryPoint) => Promise<void>;
  /** Retry without making the user start over (PRD §31). */
  retry: () => Promise<void>;
  reset: () => void;
}

export const useImportStore = create<ImportState>((set, get) => ({
  status: 'idle',
  input: null,
  entryPoint: 'paste_link',
  failure: null,
  startedAt: null,

  async start(input, entryPoint) {
    if (!entitlements.canImport(0)) {
      set({
        status: 'failed',
        input,
        entryPoint,
        failure: {
          kind: 'processing_failed',
          message: "You've used all your imports this month.",
          retryable: false,
        },
      });
      return;
    }

    const startedAt = Date.now();
    set({ status: 'processing', input, entryPoint, failure: null, startedAt });
    track({ name: 'import_started', source: entryPoint });

    const outcome = await importWorkout(input, importDependencies);
    const platform = input.url ? (parseSourceUrl(input.url)?.platform ?? 'other') : 'upload';

    if (outcome.status === 'failed') {
      track({
        name: 'import_failed',
        platform,
        reason: outcome.failure.kind,
        retryable: outcome.failure.retryable,
      });
      set({ status: 'failed', failure: outcome.failure });
      return;
    }

    // Retain the extraction separately from the workout, so later edits never
    // overwrite what the AI actually produced.
    await repositories.extractions.save(outcome.extraction);
    await repositories.exercises.upsertMany(outcome.exercises);

    useDraftStore.getState().loadFromImport(outcome.workout, outcome.extraction.id);

    track({
      name: 'import_succeeded',
      platform,
      durationMs: Date.now() - startedAt,
      exerciseCount: outcome.workout.blocks.reduce(
        (sum, block) => sum + block.exercises.length,
        0,
      ),
    });
    set({ status: 'ready', failure: null });
  },

  async retry() {
    const { input, entryPoint } = get();
    if (!input) return;
    await get().start(input, entryPoint);
  },

  reset() {
    set({ status: 'idle', input: null, failure: null, startedAt: null });
  },
}));
