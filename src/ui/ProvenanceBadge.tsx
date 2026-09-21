import { StyleSheet, View } from 'react-native';
import { Text } from './Text';
import { colors, radius, spacing } from './theme';
import { fieldStatus, type ExtractedField } from '@/core/schema/provenance';

/**
 * Makes provenance visible.
 *
 * The PRD's central promise only holds if the user can *see* the difference between
 * "the creator said this", "we think we recognised this", "we are not sure", and
 * "this was never stated" (PRD §3.1–§3.3, §6, §9). These badges are that difference.
 */

export function ReviewBadge({ label }: { label: string }) {
  return (
    <View style={[styles.badge, styles.warning]}>
      <Text variant="label" tone="warning">
        ⚠️ {label}
      </Text>
    </View>
  );
}

export function NotSpecifiedBadge({ label = 'Not specified' }: { label?: string }) {
  return (
    <View style={[styles.badge, styles.muted]}>
      <Text variant="label" tone="muted" uppercase>
        {label}
      </Text>
    </View>
  );
}

export function EditedBadge() {
  return (
    <View style={[styles.badge, styles.accent]}>
      <Text variant="label" tone="accent" uppercase>
        Edited
      </Text>
    </View>
  );
}

/** "AI identified" — never phrased as though the creator said it (PRD §21). */
export function AiIdentifiedBadge() {
  return (
    <View style={[styles.badge, styles.muted]}>
      <Text variant="label" tone="muted" uppercase>
        AI identified
      </Text>
    </View>
  );
}

export function FieldBadges({
  field,
  unclearLabel,
}: {
  field: ExtractedField<unknown> | undefined;
  unclearLabel: string;
}) {
  const status = fieldStatus(field);
  if (status === 'unclear') return <ReviewBadge label={`${unclearLabel}: Unclear`} />;
  if (status === 'user_set' && field?.supersedes) return <EditedBadge />;
  if (status === 'specified' && field?.source === 'visual_identification') {
    return <AiIdentifiedBadge />;
  }
  return null;
}

/** Creator-authored coaching, always attributed as such. */
export function CreatorCue({ cue }: { cue: string }) {
  return (
    <View style={styles.cue}>
      <Text variant="label" tone="accent" uppercase>
        Creator cue
      </Text>
      <Text variant="small" tone="secondary" style={styles.cueText}>
        “{cue}”
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    alignSelf: 'flex-start',
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderRadius: radius.sm,
    borderWidth: 1,
  },
  warning: { backgroundColor: colors.warningSurface, borderColor: colors.warning },
  muted: { backgroundColor: colors.surfaceElevated, borderColor: colors.border },
  accent: { backgroundColor: 'transparent', borderColor: colors.accent },
  cue: {
    borderLeftWidth: 3,
    borderLeftColor: colors.accent,
    paddingLeft: spacing.md,
    gap: spacing.xs,
    marginTop: spacing.xs,
  },
  cueText: { fontStyle: 'italic' },
});
