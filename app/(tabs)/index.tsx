import { useMemo } from 'react';
import { StyleSheet, View } from 'react-native';
import { Redirect, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Button, Card, Screen, Text, colors, spacing } from '@/ui';
import { useLibraryStore, workoutSubtitle } from '@/state/libraryStore';
import { useSessionStore } from '@/state/sessionStore';
import { useOnboarding } from '@/state/useOnboarding';
import { platformLabel } from '@/core/ingestion/urls';

/**
 * Home (PRD §16).
 *
 * One job: get the user from "I should try this workout sometime" to "Start Workout".
 * So the screen is a primary import CTA, a resume affordance when a workout was
 * interrupted, and a short list of recent work. Nothing to scroll endlessly.
 */
export default function HomeScreen() {
  const router = useRouter();
  const { checked, onboarded } = useOnboarding();
  const workouts = useLibraryStore((state) => state.workouts);
  const activeSession = useSessionStore((state) => state.session);
  const activeWorkout = useSessionStore((state) => state.workout);

  const recent = useMemo(() => workouts.slice(0, 3), [workouts]);

  if (!checked) return <Screen><View /></Screen>;
  if (!onboarded) return <Redirect href="/onboarding" />;

  const canResume = activeSession?.status === 'active' && activeWorkout;

  return (
    <Screen scroll>
      <View style={styles.header}>
        <Text variant="label" tone="accent" uppercase>
          Repurpose
        </Text>
        <Text variant="title">Turn a video into a workout you can actually do.</Text>
      </View>

      {canResume ? (
        <Card style={styles.resume}>
          <Text variant="label" tone="accent" uppercase>
            Workout in progress
          </Text>
          <Text variant="heading">{activeWorkout.title}</Text>
          <Button label="Resume workout" onPress={() => router.push('/session/active')} />
        </Card>
      ) : null}

      <View style={styles.primary}>
        <Button
          label="Import a Workout"
          size="large"
          onPress={() => router.push('/import')}
          accessibilityHint="Paste a link to a workout video to convert it"
        />
        <Text variant="small" tone="muted" style={styles.shareHint}>
          Or share a video to Repurpose from TikTok, Instagram or YouTube.
        </Text>
      </View>

      <View style={styles.section}>
        <Text variant="label" tone="secondary" uppercase>
          Recent workouts
        </Text>

        {recent.length === 0 ? (
          <Card>
            <Text variant="body" tone="secondary">
              Nothing here yet. Import a workout video and it will show up here, ready to
              train.
            </Text>
          </Card>
        ) : (
          recent.map((workout) => (
            <Card
              key={workout.id}
              accessibilityLabel={`Open ${workout.title}`}
              onPress={() => router.push(`/workout/${workout.id}`)}
            >
              <Text variant="heading">{workout.title}</Text>
              <View style={styles.metaRow}>
                <Text variant="small" tone="muted">
                  {platformLabel(workout.source.platform)}
                  {workout.source.creatorHandle ? ` · ${workout.source.creatorHandle}` : ''}
                </Text>
                <Text variant="small" tone="muted">
                  {workoutSubtitle(workout)}
                </Text>
              </View>
            </Card>
          ))
        )}
      </View>

      {recent.length > 0 ? (
        <Button
          label="See all workouts"
          variant="ghost"
          onPress={() => router.push('/library')}
        />
      ) : null}

      <View style={styles.footnote}>
        <Ionicons name="information-circle-outline" size={16} color={colors.textMuted} />
        <Text variant="small" tone="muted" style={styles.footnoteText}>
          Workouts come from their original creators. Repurpose organises them — it does
          not review them for safety or suitability.
        </Text>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: { paddingTop: spacing.xl, paddingBottom: spacing.xl, gap: spacing.sm },
  resume: { marginBottom: spacing.xl, borderColor: colors.accent },
  primary: { gap: spacing.md, marginBottom: spacing.xxl },
  shareHint: { textAlign: 'center' },
  section: { gap: spacing.md, marginBottom: spacing.lg },
  metaRow: { flexDirection: 'row', justifyContent: 'space-between', gap: spacing.sm },
  footnote: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: spacing.xl,
    alignItems: 'flex-start',
  },
  footnoteText: { flex: 1 },
});
