import { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Screen, Text, colors, spacing } from '@/ui';
import { PROGRESS_LABELS, useImportStore } from '@/state/importStore';

/**
 * "Creating your workout…" (PRD §5).
 *
 * The labels rotate on a timer and there is no percentage bar, because the pipeline
 * cannot honestly report progress. The PRD is explicit about not implying precision
 * the system does not have — so the screen describes what is broadly happening and
 * does not pretend to measure it.
 */
export default function ProcessingScreen() {
  const router = useRouter();
  const status = useImportStore((state) => state.status);
  const [labelIndex, setLabelIndex] = useState(0);

  useEffect(() => {
    const interval = setInterval(() => {
      setLabelIndex((index) => Math.min(index + 1, PROGRESS_LABELS.length - 1));
    }, 900);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if (status === 'ready') router.replace('/import/review');
    if (status === 'failed') router.replace('/import/failed');
  }, [status, router]);

  return (
    <Screen>
      <View style={styles.content}>
        <ActivityIndicator size="large" color={colors.accent} />
        <Text variant="title" style={styles.title}>
          Creating your workout…
        </Text>
        <Text variant="body" tone="secondary" style={styles.label}>
          {PROGRESS_LABELS[labelIndex]}
        </Text>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.lg },
  title: { textAlign: 'center' },
  label: { textAlign: 'center' },
});
