import { ActivityIndicator, Pressable, StyleSheet, View, type ViewStyle } from 'react-native';
import { Text } from './Text';
import { colors, radius, spacing, touch } from './theme';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';
type Size = 'regular' | 'large';

export interface ButtonProps {
  label: string;
  onPress?: () => void;
  variant?: Variant;
  size?: Size;
  disabled?: boolean;
  loading?: boolean;
  style?: ViewStyle;
  accessibilityHint?: string;
}

/**
 * `size="large"` exists for in-workout controls such as COMPLETE SET: a 72pt target
 * that can be hit without looking (PRD §39).
 */
export function Button({
  label,
  onPress,
  variant = 'primary',
  size = 'regular',
  disabled,
  loading,
  style,
  accessibilityHint,
}: ButtonProps) {
  const isDisabled = disabled || loading;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled: !!isDisabled, busy: !!loading }}
      onPress={isDisabled ? undefined : onPress}
      style={({ pressed }) => [
        styles.base,
        size === 'large' ? styles.large : styles.regular,
        VARIANTS[variant].container,
        pressed && !isDisabled ? VARIANTS[variant].pressed : null,
        isDisabled ? styles.disabled : null,
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={VARIANTS[variant].textColor} />
      ) : (
        <View style={styles.content}>
          <Text
            variant={size === 'large' ? 'heading' : 'body'}
            uppercase={size === 'large'}
            style={{
              color: VARIANTS[variant].textColor,
              letterSpacing: size === 'large' ? 1.5 : 0,
              fontWeight: '800',
            }}
          >
            {label}
          </Text>
        </View>
      )}
    </Pressable>
  );
}

const VARIANTS: Record<Variant, { container: ViewStyle; pressed: ViewStyle; textColor: string }> = {
  primary: {
    container: { backgroundColor: colors.accent },
    pressed: { backgroundColor: colors.accentPressed },
    textColor: colors.onAccent,
  },
  secondary: {
    container: { backgroundColor: colors.surfaceElevated, borderWidth: 1, borderColor: colors.border },
    pressed: { backgroundColor: colors.border },
    textColor: colors.text,
  },
  ghost: {
    container: { backgroundColor: 'transparent' },
    pressed: { backgroundColor: colors.surface },
    textColor: colors.textSecondary,
  },
  danger: {
    container: { backgroundColor: 'transparent', borderWidth: 1, borderColor: colors.danger },
    pressed: { backgroundColor: colors.surface },
    textColor: colors.danger,
  },
};

const styles = StyleSheet.create({
  base: {
    borderRadius: radius.lg,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.lg,
  },
  regular: { minHeight: touch.minimum, paddingVertical: spacing.md },
  large: { minHeight: touch.primaryAction, paddingVertical: spacing.lg, borderRadius: radius.xl },
  content: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  disabled: { opacity: 0.4 },
});
