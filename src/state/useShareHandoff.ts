import { useEffect, useRef } from 'react';
import { useRouter } from 'expo-router';
import { useShareIntentContext } from 'expo-share-intent';
import { resolveSharedContent } from '@/core/ingestion/shareIntent';
import { useImportStore } from './importStore';

/**
 * "Share → Repurpose" (PRD §18).
 *
 * Watches for content shared into the app and drops it straight into the import
 * flow. The user should never have to tap Analyze after sharing — arriving on the
 * processing screen with work already underway *is* the feature.
 *
 * All the interpretation lives in `resolveSharedContent`, which is pure and tested;
 * this hook only handles the effects: navigate, start, and clear.
 */
export function useShareHandoff(): void {
  const router = useRouter();
  const { hasShareIntent, shareIntent, resetShareIntent } = useShareIntentContext();
  const start = useImportStore((state) => state.start);
  // A share intent survives until reset, and re-running an import on every render
  // would be both wrong and expensive.
  const handled = useRef<string | null>(null);

  useEffect(() => {
    if (!hasShareIntent) return;

    const signature = JSON.stringify([shareIntent.webUrl, shareIntent.text, shareIntent.files]);
    if (handled.current === signature) return;
    handled.current = signature;

    const resolved = resolveSharedContent(shareIntent);
    resetShareIntent();

    if (resolved.status === 'nothing_usable') {
      // Nothing to work with. Send them to the import screen rather than a dead end.
      router.push('/import');
      return;
    }

    if (resolved.status === 'unsupported_url') {
      // Reuse the existing failure screen instead of inventing a second one.
      useImportStore.setState({
        status: 'failed',
        input: { url: resolved.url },
        entryPoint: 'share_sheet',
        failure: {
          kind: 'unsupported_url',
          message: "We don't support this source yet.",
          retryable: false,
        },
      });
      router.push('/import/failed');
      return;
    }

    router.push('/import/processing');
    void start(resolved.input, resolved.entryPoint);
  }, [hasShareIntent, shareIntent, resetShareIntent, router, start]);
}
