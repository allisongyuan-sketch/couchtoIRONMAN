import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Button, Screen, Text, colors, radius, spacing } from '@/ui';
import { completeOnboarding } from '@/state/useOnboarding';

/**
 * Onboarding (PRD §25).
 *
 * Three screens, no fitness questionnaire, no account. The aha moment is a converted
 * workout, so nothing is allowed to stand between the user and their first import
 * (PRD §26 — try first, account later).
 */
const SLIDES = [
  {
    title: 'Stop saving workouts you’ll never do.',
    body: 'Turn workout videos into workouts you can actually follow.',
  },
  {
    title: 'Share. Convert. Train.',
    body: 'Share a workout video to Repurpose and we’ll organise the routine for you.',
  },
  {
    title: 'Ready when you are.',
    body: 'Import your first workout and we’ll guide you through it, set by set.',
  },
] as const;

export default function OnboardingScreen() {
  const router = useRouter();
  const [index, setIndex] = useState(0);
  const slide = SLIDES[index]!;
  const isLast = index === SLIDES.length - 1;

  async function finish() {
    await completeOnboarding();
    router.replace(isLast ? '/import' : '/');
  }

  return (
    <Screen
      footer={
        <View style={styles.footer}>
          <Button
            label={isLast ? 'Import Your First Workout' : 'Continue'}
            size="large"
            onPress={() => (isLast ? void finish() : setIndex(index + 1))}
          />
          {!isLast ? <Button label="Skip" variant="ghost" onPress={() => void finish()} /> : null}
        </View>
      }
    >
      <View style={styles.content}>
        <Text variant="label" tone="accent" uppercase>
          Repurpose
        </Text>
        <Text variant="display" style={styles.title}>
          {slide.title}
        </Text>
        <Text variant="body" tone="secondary">
          {slide.body}
        </Text>
      </View>

      <View style={styles.dots}>
        {SLIDES.map((entry, position) => (
          <View
            key={entry.title}
            style={[styles.dot, position === index ? styles.dotActive : null]}
          />
        ))}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { flex: 1, justifyContent: 'center', gap: spacing.lg },
  title: { lineHeight: 46 },
  dots: { flexDirection: 'row', gap: spacing.sm, justifyContent: 'center', paddingBottom: spacing.xl },
  dot: {
    width: 8,
    height: 8,
    borderRadius: radius.pill,
    backgroundColor: colors.border,
  },
  dotActive: { backgroundColor: colors.accent, width: 24 },
  footer: { gap: spacing.sm },
});
