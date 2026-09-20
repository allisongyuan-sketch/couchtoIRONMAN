import { StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Button, Card, Screen, Text, colors, spacing } from '@/ui';
import { useSessionStore } from '@/state/sessionStore';
import { formatDuration } from '@/core/schema/workout';

/** Workout complete (PRD §24, §38). Short, celebratory, and out of the way. */
export default function WorkoutCompleteScreen() {
  const router = useRouter();
  const summary = useSessionStore((state) => state.summary);
  const workout = useSessionStore((state) => state.workout);
  const clear = useSessionStore((state) => state.clear);

  function done(destination: '/' | '/library') {
    const workoutId = workout?.id;
    clear();
    if (destination === '/library' && workoutId) router.replace(`/workout/${workoutId}`);
    else router.replace(destination);
  }

  return (
    <Screen
      footer={
        <View style={styles.footer}>
          <Button label="Done" size="large" onPress={() => done('/')} />
          {workout ? (
            <Button label="View workout" variant="secondary" onPress={() => done('/library')} />
          ) : null}
        </View>
      }
    >
      <View style={styles.content}>
        <Text variant="display" tone="accent">
          Workout Complete ✓
        </Text>
        <Text variant="heading">{summary?.workoutTitle ?? workout?.title ?? 'Nice work'}</Text>

        {summary ? (
          <Card style={styles.summary}>
            <Row label="Time" value={formatDuration(summary.durationSeconds)} />
            <Row
              label="Exercises"
              value={`${summary.exercisesCompleted} of ${summary.exercisesTotal} completed`}
            />
            {summary.creatorHandle ? <Row label="Creator" value={summary.creatorHandle} /> : null}
          </Card>
        ) : null}

        <Text variant="small" tone="muted" style={styles.note}>
          This workout stays in your Library, ready whenever you want it again.
        </Text>
      </View>
    </Screen>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.row}>
      <Text variant="small" tone="secondary">
        {label}
      </Text>
      <Text variant="body">{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  content: { flex: 1, justifyContent: 'center', gap: spacing.md },
  summary: { marginTop: spacing.lg, gap: spacing.md, borderColor: colors.accent },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  note: { marginTop: spacing.lg },
  footer: { gap: spacing.sm },
});
