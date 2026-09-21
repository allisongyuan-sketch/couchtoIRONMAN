import type { ReactNode } from 'react';
import { ScrollView, StyleSheet, View, type ViewStyle } from 'react-native';
import { SafeAreaView, type Edge } from 'react-native-safe-area-context';
import { colors, spacing } from './theme';

export interface ScreenProps {
  children: ReactNode;
  scroll?: boolean;
  /** Pinned to the bottom, outside the scroll area — for primary actions. */
  footer?: ReactNode;
  padded?: boolean;
  edges?: readonly Edge[];
  style?: ViewStyle;
}

export function Screen({
  children,
  scroll = false,
  footer,
  padded = true,
  edges = ['top'],
  style,
}: ScreenProps) {
  const content = padded ? styles.padded : undefined;

  return (
    <SafeAreaView style={[styles.safe, style]} edges={edges}>
      {scroll ? (
        <ScrollView
          contentContainerStyle={[content, styles.scrollContent]}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {children}
        </ScrollView>
      ) : (
        <View style={[styles.flex, content]}>{children}</View>
      )}
      {footer ? <View style={styles.footer}>{footer}</View> : null}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  flex: { flex: 1 },
  padded: { paddingHorizontal: spacing.lg },
  scrollContent: { paddingBottom: spacing.xxl },
  footer: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.xl,
    backgroundColor: colors.background,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
});
