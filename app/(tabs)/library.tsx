import { useEffect, useMemo, useState } from 'react';
import { FlatList, StyleSheet, TextInput, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Button, Card, Screen, Text, colors, radius, spacing } from '@/ui';
import { filterWorkouts, useLibraryStore, workoutSubtitle } from '@/state/libraryStore';
import { platformLabel } from '@/core/ingestion/urls';
import { exerciseCount, type Workout } from '@/core/schema/workout';

/**
 * Library (PRD §16).
 *
 * Saved converted workouts with search. No categorisation, no filters — the PRD is
 * explicit about not overbuilding this for the MVP.
 */
export default function LibraryScreen() {
  const router = useRouter();
  const workouts = useLibraryStore((state) => state.workouts);
  const load = useLibraryStore((state) => state.load);
  const [query, setQuery] = useState('');

  useEffect(() => {
    void load();
  }, [load]);

  const visible = useMemo(() => filterWorkouts(workouts, query), [workouts, query]);

  return (
    <Screen padded={false}>
      <View style={styles.header}>
        <Text variant="title">Library</Text>
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder="Search workouts, creators, exercises"
          placeholderTextColor={colors.textMuted}
          style={styles.search}
          accessibilityLabel="Search workouts"
          autoCorrect={false}
        />
      </View>

      <FlatList
        data={visible}
        keyExtractor={(workout) => workout.id}
        contentContainerStyle={styles.list}
        keyboardShouldPersistTaps="handled"
        ListEmptyComponent={
          <Card>
            <Text variant="body" tone="secondary">
              {workouts.length === 0
                ? 'Your converted workouts will live here.'
                : 'No workouts match that search.'}
            </Text>
            {workouts.length === 0 ? (
              <Button
                label="Import a Workout"
                variant="secondary"
                onPress={() => router.push('/import')}
              />
            ) : null}
          </Card>
        }
        renderItem={({ item }) => (
          <WorkoutCard workout={item} onPress={() => router.push(`/workout/${item.id}`)} />
        )}
      />
    </Screen>
  );
}

function WorkoutCard({ workout, onPress }: { workout: Workout; onPress: () => void }) {
  const structureLabel = STRUCTURE_LABELS[workout.structure] ?? 'Workout';

  return (
    <Card accessibilityLabel={`Open ${workout.title}`} onPress={onPress}>
      <Text variant="heading">{workout.title}</Text>
      <Text variant="small" tone="muted">
        {workout.source.creatorHandle ? `${workout.source.creatorHandle} · ` : ''}
        {platformLabel(workout.source.platform)}
      </Text>
      <View style={styles.metaRow}>
        <Text variant="small" tone="secondary">
          {structureLabel} · {workoutSubtitle(workout)}
        </Text>
        {workout.lastPerformedAt ? (
          <Text variant="small" tone="muted">
            {new Date(workout.lastPerformedAt).toLocaleDateString()}
          </Text>
        ) : null}
      </View>
      {exerciseCount(workout) === 0 ? (
        <Text variant="small" tone="warning">
          No exercises yet
        </Text>
      ) : null}
    </Card>
  );
}

const STRUCTURE_LABELS: Record<string, string> = {
  straight_sets: 'Straight sets',
  circuit: 'Circuit',
  superset: 'Superset',
  interval: 'Intervals',
  amrap: 'AMRAP',
  emom: 'EMOM',
  timed: 'Timed',
  flow: 'Sequence',
  unknown: 'Workout',
};

const styles = StyleSheet.create({
  header: { paddingHorizontal: spacing.lg, paddingTop: spacing.xl, gap: spacing.md },
  search: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    color: colors.text,
    fontSize: 16,
    minHeight: 48,
  },
  list: { padding: spacing.lg, gap: spacing.md },
  metaRow: { flexDirection: 'row', justifyContent: 'space-between', gap: spacing.sm },
});
