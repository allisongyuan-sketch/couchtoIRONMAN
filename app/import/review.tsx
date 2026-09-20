import { StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Button, Card, Screen, Text, WorkoutOutline, colors, spacing } from '@/ui';
import { openOriginal } from '@/ui/openOriginal';
import { countFieldsNeedingReview, useDraftStore } from '@/state/draftStore';
import { useSessionStore } from '@/state/sessionStore';
import { useImportStore } from '@/state/importStore';
import { platformLabel } from '@/core/ingestion/urls';

/**
 * Extraction review (PRD §6).
 *
 * The user sees what we extracted before they train, with uncertainty marked rather
 * than hidden. Four actions, exactly as the PRD specifies: Start Workout, Save for
 * Later, Edit Workout, View Original.
 */
export default function ReviewScreen() {
  const router = useRouter();
  const workout = useDraftStore((state) => state.workout);
  const save = useDraftStore((state) => state.save);
  const resetImport = useImportStore((state) => state.reset);
  const begin = useSessionStore((state) => state.begin);

  if (!workout) {
    return (
      <Screen>
        <View style={styles.empty}>
          <Text variant="body" tone="secondary">
            No workout to review.
          </Text>
          <Button label="Back to Home" variant="secondary" onPress={() => router.replace('/')} />
        </View>
      </Screen>
    );
  }

  const needsReview = countFieldsNeedingReview(workout);

  async function startWorkout() {
    const saved = await save();
    resetImport();
    if (saved) {
      begin(saved);
      router.replace('/session/active');
    }
  }

  async function saveForLater() {
    const saved = await save();
    resetImport();
    if (saved) router.replace(`/workout/${saved.id}`);
  }

  return (
    <Screen
      scroll
      footer={
        <View style={styles.footer}>
          <Button label="Start Workout" size="large" onPress={() => void startWorkout()} />
          <View style={styles.secondaryRow}>
            <Button
              label="Save for Later"
              variant="secondary"
              style={styles.flex}
              onPress={() => void saveForLater()}
            />
            <Button
              label="Edit Workout"
              variant="secondary"
              style={styles.flex}
              onPress={() => router.push('/workout/edit')}
            />
          </View>
        </View>
      }
    >
      <View style={styles.header}>
        <Text variant="label" tone="accent" uppercase>
          Your workout is ready
        </Text>
        <Text variant="title">{workout.title}</Text>
        <Text variant="small" tone="muted">
          {workout.source.creatorHandle ? `${workout.source.creatorHandle} · ` : ''}
          {platformLabel(workout.source.platform)}
        </Text>

        {workout.source.url ? (
          <Button
            label="View Original"
            variant="ghost"
            style={styles.viewOriginal}
            onPress={() => void openOriginal(workout.source.url)}
          />
        ) : null}
      </View>

      {needsReview > 0 ? (
        <Card style={styles.reviewNotice}>
          <Text variant="body">
            {needsReview === 1
              ? '1 thing is worth a look before you start.'
              : `${needsReview} things are worth a look before you start.`}
          </Text>
          <Text variant="small" tone="secondary">
            We only fill in what the creator actually said. Anything unclear or unstated is
            marked below — you can set it yourself in the editor.
          </Text>
        </Card>
      ) : null}

      <WorkoutOutline workout={workout} />

      {workout.workoutNotes.map((note, index) =>
        note.value ? (
          <Text key={index} variant="small" tone="muted" style={styles.note}>
            {note.value}
          </Text>
        ) : null,
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: { paddingTop: spacing.lg, paddingBottom: spacing.xl, gap: spacing.xs },
  viewOriginal: { alignSelf: 'flex-start', paddingHorizontal: 0, marginTop: spacing.sm },
  reviewNotice: { marginBottom: spacing.xl, borderColor: colors.warning },
  note: { marginTop: spacing.lg },
  footer: { gap: spacing.sm },
  secondaryRow: { flexDirection: 'row', gap: spacing.sm },
  flex: { flex: 1 },
  empty: { flex: 1, justifyContent: 'center', gap: spacing.lg },
});
