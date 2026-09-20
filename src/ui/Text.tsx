import { Text as RNText, type TextProps as RNTextProps, type TextStyle } from 'react-native';
import { colors, typography } from './theme';

type Variant = keyof typeof typography;
type Tone = 'default' | 'secondary' | 'muted' | 'accent' | 'warning' | 'rest' | 'danger';

export interface TextProps extends RNTextProps {
  variant?: Variant;
  tone?: Tone;
  uppercase?: boolean;
}

const TONES: Record<Tone, string> = {
  default: colors.text,
  secondary: colors.textSecondary,
  muted: colors.textMuted,
  accent: colors.accent,
  warning: colors.warning,
  rest: colors.rest,
  danger: colors.danger,
};

export function Text({
  variant = 'body',
  tone = 'default',
  uppercase,
  style,
  ...rest
}: TextProps) {
  const base = typography[variant] as TextStyle;
  return (
    <RNText
      {...rest}
      style={[
        base,
        { color: TONES[tone] },
        uppercase ? { textTransform: 'uppercase' } : null,
        style,
      ]}
    />
  );
}
