import { StyleSheet, View } from 'react-native';
import { Button, Card, Screen, Text, spacing } from '@/ui';
import { useLibraryStore } from '@/state/libraryStore';
import { useHistoryStore } from '@/state/historyStore';
import { entitlements } from '@/core/entitlements';

/**
 * Profile / settings (PRD §24, §26).
 *
 * No account is required to use the app. Sign-in exists to sync and preserve history
 * across devices, so it is offered here rather than demanded at launch — the user
 * should reach their first converted workout before they are asked to register.
 */
export default function ProfileScreen() {
  const workoutCount = useLibraryStore((state) => state.workouts.length);
  const sessionCount = useHistoryStore((state) => state.entries.length);
  const plan = entitlements.current().plan;

  return (
    <Screen scroll>
      <View style={styles.header}>
        <Text variant="title">Profile</Text>
      </View>

      <Card>
        <Text variant="label" tone="secondary" uppercase>
          Your data
        </Text>
        <Text variant="body">
          {workoutCount} saved {workoutCount === 1 ? 'workout' : 'workouts'}
        </Text>
        <Text variant="body">
          {sessionCount} completed {sessionCount === 1 ? 'session' : 'sessions'}
        </Text>
        <Text variant="small" tone="muted">
          Everything is stored on this device. Nothing is synced yet.
        </Text>
      </Card>

      <Card style={styles.card}>
        <Text variant="label" tone="secondary" uppercase>
          Account
        </Text>
        <Text variant="body" tone="secondary">
          Create an account to keep your workouts if you change devices.
        </Text>
        <Button label="Sign in with Apple" variant="secondary" disabled />
        <Button label="Continue with Google" variant="secondary" disabled />
        <Button label="Use email" variant="ghost" disabled />
        <Text variant="small" tone="muted">
          Coming soon. You don’t need an account to import or train.
        </Text>
      </Card>

      <Card style={styles.card}>
        <Text variant="label" tone="secondary" uppercase>
          Plan
        </Text>
        <Text variant="body">{plan === 'pro' ? 'Pro' : 'Free'}</Text>
        <Text variant="small" tone="muted">
          Imports are unlimited while we learn what works.
        </Text>
      </Card>

      <Card style={styles.card}>
        <Text variant="label" tone="secondary" uppercase>
          About
        </Text>
        <Text variant="small" tone="secondary">
          Repurpose organises workouts created by other people. Workouts are not reviewed
          for safety and may not be suitable for everyone. Check with a qualified
          professional if you are unsure, especially for rehabilitation content.
        </Text>
      </Card>
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: { paddingTop: spacing.xl, paddingBottom: spacing.lg },
  card: { marginTop: spacing.md },
});
