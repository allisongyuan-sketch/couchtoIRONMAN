import { useState } from 'react';
import { StyleSheet, TextInput, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Button, Card, Screen, Text, colors, radius, spacing } from '@/ui';
import { isSupportedSourceUrl } from '@/core/ingestion/urls';
import { useImportStore } from '@/state/importStore';
import { useDraftStore } from '@/state/draftStore';
import { createEmptyWorkout } from '@/core/editing/operations';

/**
 * Import by pasted link (PRD §18).
 *
 * The share sheet is the ideal path, but paste-a-link is the one that works on every
 * device today and needs no native build — so it is a first-class entry point rather
 * than a fallback.
 */
export default function ImportScreen() {
  const router = useRouter();
  const [url, setUrl] = useState('');
  const start = useImportStore((state) => state.start);
  const loadExisting = useDraftStore((state) => state.loadExisting);

  const trimmed = url.trim();
  const supported = trimmed.length > 0 && isSupportedSourceUrl(trimmed);
  const showUnsupported = trimmed.length > 8 && !supported;

  async function analyze() {
    router.push('/import/processing');
    await start({ url: trimmed }, 'paste_link');
  }

  function enterManually() {
    loadExisting(createEmptyWorkout());
    router.push('/import/review');
  }

  return (
    <Screen
      scroll
      footer={
        <Button label="Analyze" size="large" disabled={!supported} onPress={() => void analyze()} />
      }
    >
      <View style={styles.header}>
        <Text variant="title">Paste a workout link</Text>
        <Text variant="body" tone="secondary">
          TikTok, Instagram Reels or YouTube Shorts.
        </Text>
      </View>

      <TextInput
        value={url}
        onChangeText={setUrl}
        placeholder="https://www.tiktok.com/@creator/video/…"
        placeholderTextColor={colors.textMuted}
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType="url"
        inputMode="url"
        accessibilityLabel="Workout video link"
        style={styles.input}
      />

      {showUnsupported ? (
        <Card style={styles.notice}>
          <Text variant="body">We don’t support this source yet.</Text>
          <Text variant="small" tone="secondary">
            Repurpose currently reads TikTok, Instagram and YouTube links. You can still
            upload the video or enter the workout yourself.
          </Text>
        </Card>
      ) : null}

      <View style={styles.alternatives}>
        <Text variant="label" tone="secondary" uppercase>
          Other ways in
        </Text>
        <Button label="Enter workout manually" variant="secondary" onPress={enterManually} />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: { paddingTop: spacing.xl, paddingBottom: spacing.lg, gap: spacing.sm },
  input: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.lg,
    color: colors.text,
    fontSize: 16,
    minHeight: 56,
  },
  notice: { marginTop: spacing.lg, borderColor: colors.warning },
  alternatives: { marginTop: spacing.xxl, gap: spacing.md },
});
