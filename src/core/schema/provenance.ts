import { z } from 'zod';

/**
 * Provenance is the product's spine (PRD §3.1, §3.2, §3.3, §21).
 *
 * Every extracted value carries WHERE it came from and HOW sure we are. This is what
 * lets the app honour the central promise: extract, don't invent. The UI can then show
 * creator-stated facts, AI-identified movements, and missing information as three
 * visibly different things.
 */
export const FIELD_SOURCES = [
  'speech',
  'onscreen_text',
  'caption',
  'visual_identification',
  'user',
] as const;

export type FieldSource = (typeof FIELD_SOURCES)[number];

export const fieldSourceSchema = z.enum(FIELD_SOURCES);

export interface ExtractedField<T> {
  value: T | null;
  source: FieldSource;
  confidence?: number;
  needsReview: boolean;
  /** The value this one replaced. Set when a user overrides an extracted value. */
  supersedes?: Omit<ExtractedField<T>, 'supersedes'>;
}

/**
 * Below this, a value is shown as "Unclear ⚠️" rather than stated as fact (PRD §9).
 * We would rather ask the user than quietly assert "12 reps" when the audio was mush.
 */
export const REVIEW_CONFIDENCE_THRESHOLD = 0.75;

export const extractedFieldSchema = <T extends z.ZodType>(inner: T) =>
  z.object({
    value: inner.nullable(),
    source: fieldSourceSchema,
    confidence: z.number().min(0).max(1).optional(),
    needsReview: z.boolean(),
    supersedes: z
      .object({
        value: inner.nullable(),
        source: fieldSourceSchema,
        confidence: z.number().min(0).max(1).optional(),
        needsReview: z.boolean(),
      })
      .optional(),
  });

/** How a field should be presented. Derived, never stored — storage holds only facts. */
export type FieldStatus = 'specified' | 'not_specified' | 'unclear' | 'user_set';

export function fieldStatus<T>(field: ExtractedField<T> | undefined): FieldStatus {
  if (!field || field.value === null || field.value === undefined) return 'not_specified';
  if (field.source === 'user') return 'user_set';
  if (field.needsReview) return 'unclear';
  return 'specified';
}

/** True when the creator never gave us this. Renders as "Not specified" (PRD §8). */
export function isNotSpecified<T>(field: ExtractedField<T> | undefined): boolean {
  return fieldStatus(field) === 'not_specified';
}

/** Convenience for reading a value with an explicit fallback at the call site. */
export function valueOr<T>(field: ExtractedField<T> | undefined, fallback: T): T {
  return field?.value ?? fallback;
}

/**
 * Build a field from source material. Confidence below the threshold automatically
 * flags the field for review — a caller cannot forget to do this.
 */
export function extracted<T>(
  value: T | null,
  source: FieldSource,
  confidence?: number,
): ExtractedField<T> {
  const needsReview =
    value !== null && confidence !== undefined && confidence < REVIEW_CONFIDENCE_THRESHOLD;
  return confidence === undefined
    ? { value, source, needsReview }
    : { value, source, confidence, needsReview };
}

/**
 * The creator did not provide this. Note there is no `defaultTo(...)` counterpart
 * anywhere in this codebase — that absence is intentional (PRD §3.1).
 */
export function notSpecified<T>(source: FieldSource = 'speech'): ExtractedField<T> {
  return { value: null, source, needsReview: false };
}

/**
 * A user correction. The prior value is preserved in `supersedes` so that creator
 * intent is never destroyed and the extraction edit rate stays measurable (PRD §29).
 */
export function userField<T>(
  value: T | null,
  previous?: ExtractedField<T>,
): ExtractedField<T> {
  const field: ExtractedField<T> = { value, source: 'user', confidence: 1, needsReview: false };
  if (previous && previous.source !== 'user') {
    const { supersedes: _dropped, ...prior } = previous;
    field.supersedes = prior;
  } else if (previous?.supersedes) {
    field.supersedes = previous.supersedes;
  }
  return field;
}

/** Did a human change this away from what we extracted? Drives the edit-rate metric. */
export function wasCorrectedByUser<T>(field: ExtractedField<T> | undefined): boolean {
  return field?.source === 'user' && field.supersedes !== undefined;
}
