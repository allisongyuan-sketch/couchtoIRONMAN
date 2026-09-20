import { StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Button, Card, Screen, Text, colors, spacing } from '@/ui';
import { useImportStore } from '@/state/importStore';
import { useDraftStore } from '@/state/draftStore';
import { createEmptyWorkout } from '@/core/editing/operations';
import { openOriginal } from '@/ui/openOriginal';

/**
 * Import failure states (PRD §31).
 *
 * Every failure keeps whatever we did recover — the creator, the link — and offers a
 * way forward. A failed import should never dead-end into "try again later", and
 * retry must never require starting over.
 */
export default function ImportFailedScreen() {
  const router = useRouter();
  const failure = useImportStore((state) => state.failure);
  const retry = useImportStore((state) => state.retry);
  const reset = useImportStore((state) => state.reset);
  const loadExisting = useDraftStore((state) => state.loadExisting);

  const title = TITLES[failure?.kind ?? 'processing_failed'];

  function enterManually() {
    loadExisting(createEmptyWorkout());
    reset();
    router.replace('/import/review');
  }

  async function retryImport() {
    router.replace('/import/processing');
    await retry();
  }

  return (
    <Screen
      scroll
      footer={
        <View style={styles.footer}>
          {failure?.retryable ? (
            <Button label="Try again" size="large" onPress={() => void retryImport()} />
          ) : null}
          <Button label="Enter workout manually" variant="secondary" onPress={enterManually} />
          <Button
            label="Try another link"
            variant="ghost"
            onPress={() => {
              reset();
              router.replace('/import');
            }}
          />
        </View>
      }
    >
      <View style={styles.header}>
        <Text variant="title">{title}</Text>
        <Text variant="body" tone="secondary">
          {failure?.message ?? 'Something went wrong while analysing this video.'}
        </Text>
      </View>

      {failure?.source?.url ? (
        <Card>
          <Text variant="label" tone="secondary" uppercase>
            Original video
          </Text>
          <Text variant="body">{failure.source.creatorHandle ?? failure.source.url}</Text>
          <Button
            label="View Original"
            variant="secondary"
            onPress={() => void openOriginal(failure.source?.url)}
          />
        </Card>
      ) : null}

      {failure?.detectedMovements?.length ? (
        <Card style={styles.detected}>
          <Text variant="label" tone="secondary" uppercase>
            What we did see
          </Text>
          {failure.detectedMovements.map((movement) => (
            <Text key={movement} variant="body">
              • {movement}
            </Text>
          ))}
          <Text variant="small" tone="muted">
            We couldn’t tell how these were meant to be performed, so we haven’t guessed.
          </Text>
        </Card>
      ) : null}
    </Screen>
  );
}

const TITLES: Record<string, string> = {
  unsupported_url: 'We don’t support this source yet',
  media_inaccessible: 'We couldn’t access enough of this video',
  no_workout_detected: 'We couldn’t find a structured workout',
  processing_failed: 'Something went wrong',
};

const styles = StyleSheet.create({
  header: { paddingTop: spacing.xl, paddingBottom: spacing.xl, gap: spacing.sm },
  detected: { marginTop: spacing.lg, gap: spacing.sm, borderColor: colors.border },
  footer: { gap: spacing.sm },
});
