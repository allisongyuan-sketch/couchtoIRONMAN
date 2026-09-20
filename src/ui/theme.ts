/**
 * Design tokens.
 *
 * PRD §39 asks for athletic, modern, extremely clean, energetic without being noisy,
 * and timer-forward during workouts. Concretely that means: a dark athletic surface
 * so the timer is the brightest thing on screen, one high-energy accent used sparingly
 * so it always means "act", and controls sized for sweaty hands and limited attention.
 */

export const colors = {
  background: '#0B0D10',
  surface: '#14181D',
  surfaceElevated: '#1C222A',
  border: '#252C35',

  text: '#F4F7FA',
  textSecondary: '#98A3AF',
  textMuted: '#69737E',

  /** The single action colour. If it is volt, it is tappable and it matters. */
  accent: '#C8FF2E',
  accentPressed: '#A8DC18',
  onAccent: '#0B0D10',

  /** Reserved for uncertainty: "Unclear", "Not specified". Never decorative. */
  warning: '#FFB020',
  warningSurface: '#2A2011',

  danger: '#FF5A5F',
  /** Rest is a different mode from work, and should look like one. */
  rest: '#4FC3F7',
  restSurface: '#101E28',

  success: '#4ADE80',
} as const;

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
  xxxl: 48,
} as const;

export const radius = {
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  pill: 999,
} as const;

export const typography = {
  display: { fontSize: 40, fontWeight: '800', letterSpacing: -1 },
  title: { fontSize: 28, fontWeight: '800', letterSpacing: -0.5 },
  heading: { fontSize: 20, fontWeight: '700', letterSpacing: -0.3 },
  body: { fontSize: 16, fontWeight: '500' },
  small: { fontSize: 14, fontWeight: '500' },
  /** Uppercase micro-labels: "SET 1 OF 3", "ROUND 2 OF 3". */
  label: { fontSize: 12, fontWeight: '700', letterSpacing: 1.2 },
  /** The timer. Tabular figures so digits do not jitter as they count down. */
  timer: { fontSize: 76, fontWeight: '800', letterSpacing: -2, fontVariant: ['tabular-nums'] },
} as const;

/**
 * Minimum touch target. PRD §39: important workout actions must be usable with
 * sweaty hands and limited attention, so primary controls are far larger than the
 * 44pt platform floor.
 */
export const touch = {
  minimum: 48,
  primaryAction: 72,
} as const;
