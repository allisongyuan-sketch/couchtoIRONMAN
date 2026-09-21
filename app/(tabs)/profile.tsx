import { useEffect, useState } from 'react';
import { StyleSheet, TextInput, View } from 'react-native';
import { Button, Card, Screen, Text, colors, radius, spacing } from '@/ui';
import { useLibraryStore } from '@/state/libraryStore';
import { useHistoryStore } from '@/state/historyStore';
import { useAuthStore } from '@/state/authStore';
import { accountsAvailable, authService } from '@/state/container';
import { entitlements } from '@/core/entitlements';
import { isPlausibleEmail } from '@/core/auth/types';

/**
 * Profile / settings (PRD §24, §26).
 *
 * No account is required to use the app, and the screen says so rather than implying
 * a backup that does not exist. Signing in is offered for what it actually buys —
 * keeping workouts if the device changes — not as a gate.
 */
export default function ProfileScreen() {
  const workoutCount = useLibraryStore((state) => state.workouts.length);
  const sessionCount = useHistoryStore((state) => state.entries.length);
  const plan = entitlements.current().plan;

  const user = useAuthStore((state) => state.user);
  const loading = useAuthStore((state) => state.loading);
  const busy = useAuthStore((state) => state.busy);
  const message = useAuthStore((state) => state.message);
  const lastSync = useAuthStore((state) => state.lastSync);
  const initialize = useAuthStore((state) => state.initialize);
  const signInWithEmail = useAuthStore((state) => state.signInWithEmail);
  const signInWithApple = useAuthStore((state) => state.signInWithApple);
  const signInWithGoogle = useAuthStore((state) => state.signInWithGoogle);
  const signOut = useAuthStore((state) => state.signOut);
  const sync = useAuthStore((state) => state.sync);

  const [email, setEmail] = useState('');
  const methods = authService.availableMethods;

  useEffect(() => {
    void initialize();
  }, [initialize]);

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
          {user
            ? 'Backed up to your account.'
            : 'Stored on this device only. Sign in to keep it if you change phones.'}
        </Text>
      </Card>

      <Card style={styles.card}>
        <Text variant="label" tone="secondary" uppercase>
          Account
        </Text>

        {loading ? (
          <Text variant="body" tone="secondary">
            Checking…
          </Text>
        ) : !accountsAvailable ? (
          <>
            <Text variant="body" tone="secondary">
              Accounts aren’t set up for this build.
            </Text>
            <Text variant="small" tone="muted">
              Everything works without one — your workouts just live on this device.
            </Text>
          </>
        ) : user ? (
          <>
            <Text variant="body">{user.displayName ?? user.email ?? 'Signed in'}</Text>
            {lastSync ? (
              <Text variant="small" tone="muted">
                Last sync: {lastSync.workoutsUploaded} up, {lastSync.workoutsDownloaded} down
                {lastSync.conflicts > 0 ? ` · ${lastSync.conflicts} resolved` : ''}
              </Text>
            ) : null}
            <Button
              label="Sync now"
              variant="secondary"
              loading={busy}
              onPress={() => void sync()}
            />
            <Button label="Sign out" variant="ghost" onPress={() => void signOut()} />
          </>
        ) : (
          <>
            <Text variant="body" tone="secondary">
              Create an account to keep your workouts if you change devices.
            </Text>

            {methods.includes('apple') ? (
              <Button
                label="Sign in with Apple"
                variant="secondary"
                loading={busy}
                onPress={() => void signInWithApple()}
              />
            ) : null}
            {methods.includes('google') ? (
              <Button
                label="Continue with Google"
                variant="secondary"
                loading={busy}
                onPress={() => void signInWithGoogle()}
              />
            ) : null}

            {methods.includes('email') ? (
              <>
                <TextInput
                  value={email}
                  onChangeText={setEmail}
                  placeholder="you@example.com"
                  placeholderTextColor={colors.textMuted}
                  autoCapitalize="none"
                  autoCorrect={false}
                  keyboardType="email-address"
                  inputMode="email"
                  accessibilityLabel="Email address"
                  style={styles.input}
                />
                <Button
                  label="Email me a sign-in link"
                  disabled={!isPlausibleEmail(email)}
                  loading={busy}
                  onPress={() => void signInWithEmail(email)}
                />
                <Text variant="small" tone="muted">
                  No password to choose or forget — we’ll send a one-time link.
                </Text>
              </>
            ) : null}
          </>
        )}

        {message ? (
          <Text variant="small" tone="warning">
            {message}
          </Text>
        ) : null}
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
  input: {
    backgroundColor: colors.surfaceElevated,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    color: colors.text,
    fontSize: 16,
    minHeight: 48,
  },
});
