import { z } from 'zod';
import { extractedFieldSchema } from './provenance';
import { blockKindSchema, workoutSourceSchema, workoutStructureSchema } from './workout';

/* ================================================================== *
 * The AI output contract.
 *
 * The model returns strict structured data, never prose (PRD §11). What comes back is
 * NOT yet a Workout: it has no ids and no catalog links. Normalisation assigns those,
 * which keeps the model's job narrow — describe what the source said — and keeps
 * identity generation in our control.
 * ================================================================== */

const numberField = extractedFieldSchema(z.number());
const stringField = extractedFieldSchema(z.string());

export const rawExtractedExerciseSchema = z.object({
  name: stringField,
  sets: numberField.optional(),
  reps: numberField.optional(),
  repsPerSide: numberField.optional(),
  durationSeconds: numberField.optional(),
  restSeconds: numberField.optional(),
  weight: stringField.optional(),
  resistance: stringField.optional(),
  formCues: z.array(stringField).default([]),
  notes: z.array(stringField).default([]),
});
export type RawExtractedExercise = z.infer<typeof rawExtractedExerciseSchema>;

export const rawExtractedBlockSchema = z.object({
  kind: blockKindSchema,
  label: z.string().optional(),
  rounds: numberField.optional(),
  restBetweenRoundsSeconds: numberField.optional(),
  capSeconds: numberField.optional(),
  exercises: z.array(rawExtractedExerciseSchema).min(1),
});
export type RawExtractedBlock = z.infer<typeof rawExtractedBlockSchema>;

export const structuredWorkoutExtractionSchema = z.object({
  title: z.string().min(1),
  structure: workoutStructureSchema,
  blocks: z.array(rawExtractedBlockSchema).min(1),
  workoutNotes: z.array(stringField).default([]),
  /**
   * Movements the model saw but could not place into a structured workout.
   * Powers the "we found fitness content but no structured workout" state (PRD §31).
   */
  detectedMovements: z.array(z.string()).default([]),
});
export type StructuredWorkoutExtraction = z.infer<typeof structuredWorkoutExtractionSchema>;

/* ================================================================== *
 * Guardrail audit trail
 *
 * When the guardrail pass strips a prescription the source never supported, it records
 * why. This is the auditable evidence that the system extracts rather than invents —
 * and the first thing to read when extraction quality is in question.
 * ================================================================== */

export const GUARDRAIL_ACTIONS = ['stripped', 'flagged_for_review'] as const;
export type GuardrailActionKind = (typeof GUARDRAIL_ACTIONS)[number];

export const guardrailActionSchema = z.object({
  action: z.enum(GUARDRAIL_ACTIONS),
  path: z.string(),
  reason: z.string(),
});
export type GuardrailAction = z.infer<typeof guardrailActionSchema>;

/* ================================================================== *
 * Extraction entity — one AI run over one piece of source content.
 * Kept separate from the Workout so user edits never destroy the original,
 * and so extraction edit rate (PRD §29/§30) stays measurable by diff.
 * ================================================================== */

export const EXTRACTION_STATUSES = ['succeeded', 'no_workout_detected', 'failed'] as const;
export type ExtractionStatus = (typeof EXTRACTION_STATUSES)[number];

export const extractionSchema = z.object({
  id: z.string(),
  sourceContentId: z.string(),
  /** Which WorkoutExtractionService produced this, e.g. "mock" or "anthropic". */
  serviceId: z.string(),
  modelId: z.string().optional(),
  status: z.enum(EXTRACTION_STATUSES),
  source: workoutSourceSchema,
  result: structuredWorkoutExtractionSchema.nullable(),
  guardrailActions: z.array(guardrailActionSchema),
  detectedMovements: z.array(z.string()),
  failureReason: z.string().optional(),
  createdAt: z.string(),
  durationMs: z.number().min(0),
});
export type Extraction = z.infer<typeof extractionSchema>;
