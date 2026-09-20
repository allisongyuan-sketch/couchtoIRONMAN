import { useEffect, useState } from 'react';
import { Alert, StyleSheet, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Button, Screen, Text, WorkoutOutline, spacing } from '@/ui';
import { openOriginal } from '@/ui/openOriginal';
import { repositories } from '@/state/container';
import { useDraftStore } from '@/state/draftStore';
import { useSessionStore } from '@/state/sessionStore';
import { useLibraryStore } from '@/state/libraryStore';
import { platformLabel } from '@/core/ingestion/urls';
import { formatDuration, type Workout } from '@/core/schema/workout';
import { compilePlan } from '@/core/engine/plan';

/** Workout detail (PRD §24). The launchpad for a saved workout. */
export default function WorkoutDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const [workout, setWorkout] = useState<Workout | null>(null);
  const draft = useDraftStore((state) => state.workout);
  const loadExisting = useDraftStore((state) => state.loadExisting);
  const begin = useSessionStore((state) => state.begin);
  const removeFromLibrary = useLibraryStore((state) => state.remove);

  useEffect(() => {
    if (!id) return;
    // Prefer the draft when it is this workout: the user may have just edited it.
    if (draft?.id === id) {
      setWorkout(draft);
      return;
    }
    void repositories.workouts.get(id).then(setWorkout);
  }, [id, draft]);

  if (!workout) {
    return (
      <Screen>
        <View style={styles.empty}>
          <Text variant="body" tone="secondary">
            Workout not found.
          </Text>
          <Button label="Back to Library" variant="secondary" onPress={() => router.replace('/library')} />
        </View>
      </Screen>
    );
  }

  const plan = compilePlan(workout);

  function confirmDelete() {
    if (!workout) return;
    Alert.alert('Delete workout?', workout.title, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () => {
          void removeFromLibrary(workout.id);
          router.replace('/library');
        },
      },
    ]);
  }

  return (
    <Screen
      scroll
      footer={
        <View style={styles.footer}>
          <Button
            label="Start Workout"
            size="large"
            onPress={() => {
              begin(workout);
              router.push('/session/active');
            }}
          />
          <Button
            label="Edit Workout"
            variant="secondary"
            onPress={() => {
              loadExisting(workout);
              router.push('/workout/edit');
            }}
          />
        </View>
      }
    >
      <View style={styles.header}>
        <Text variant="title">{workout.title}</Text>
        <Text variant="small" tone="muted">
          {workout.source.creatorHandle ? `${workout.source.creatorHandle} · ` : ''}
          {platformLabel(workout.source.platform)}
        </Text>

        <View style={styles.stats}>
          <Text variant="small" tone="secondary">
            {plan.steps.filter((step) => step.kind === 'exercise_set').length} sets
          </Text>
          {plan.estimatedSeconds > 0 ? (
            <Text variant="small" tone="secondary">
              · at least {formatDuration(plan.estimatedSeconds)} of timed work
            </Text>
          ) : null}
        </View>

        {workout.lastPerformedAt ? (
          <Text variant="small" tone="muted">
            Last performed {new Date(workout.lastPerformedAt).toLocaleDateString()}
          </Text>
        ) : null}

        {workout.source.url ? (
          <Button
            label="View Original"
            variant="ghost"
            style={styles.inlineAction}
            onPress={() => void openOriginal(workout.source.url)}
          />
        ) : null}
      </View>

      <WorkoutOutline workout={workout} />

      <Button label="Delete workout" variant="danger" style={styles.delete} onPress={confirmDelete} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: { paddingTop: spacing.lg, paddingBottom: spacing.xl, gap: spacing.xs },
  stats: { flexDirection: 'row', gap: spacing.xs, flexWrap: 'wrap', marginTop: spacing.xs },
  inlineAction: { alignSelf: 'flex-start', paddingHorizontal: 0, marginTop: spacing.sm },
  footer: { gap: spacing.sm },
  delete: { marginTop: spacing.xxl },
  empty: { flex: 1, justifyContent: 'center', gap: spacing.lg },
});
