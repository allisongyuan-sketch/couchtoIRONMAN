import {
  REVIEW_CONFIDENCE_THRESHOLD,
  type ExtractedField,
  type FieldSource,
} from '../schema/provenance';
import type {
  GuardrailAction,
  RawExtractedBlock,
  RawExtractedExercise,
  StructuredWorkoutExtraction,
} from '../schema/extraction';

/**
 * The guardrail pass — PRD §3.1, §3.2, §21, §32.
 *
 * A prompt can ask a model not to invent a prescription. A prompt cannot *guarantee*
 * it. So the rule is enforced here, mechanically, after the model has spoken:
 *
 *   1. A quantitative field may never originate from visual identification.
 *      You can see THAT someone is doing a Romanian deadlift. You cannot see THAT
 *      they prescribed three sets of ten. Such fields are stripped to "not specified".
 *   2. Confidence below the review threshold forces needsReview, so the value is
 *      presented as "Unclear ⚠️" rather than asserted as fact.
 *   3. Form cues and notes must come from the creator. A cue sourced from visual
 *      identification is AI-authored coaching, which the product does not do — it is
 *      removed rather than shown under "Creator cue".
 *
 * Every removal is recorded, so an extraction can be audited after the fact.
 */

const QUANTITATIVE_FIELDS = [
  'sets',
  'reps',
  'repsPerSide',
  'durationSeconds',
  'restSeconds',
] as const satisfies readonly (keyof RawExtractedExercise)[];

const PRESCRIPTIVE_TEXT_FIELDS = ['weight', 'resistance'] as const satisfies readonly (keyof RawExtractedExercise)[];

/** Sources that can legitimately state a prescription: the creator said or wrote it. */
const CREATOR_SOURCES: FieldSource[] = ['speech', 'onscreen_text', 'caption', 'user'];

export interface GuardrailReport {
  result: StructuredWorkoutExtraction;
  actions: GuardrailAction[];
}

export function applyGuardrails(
  extraction: StructuredWorkoutExtraction,
): GuardrailReport {
  const actions: GuardrailAction[] = [];

  const blocks = extraction.blocks.map((block, blockIndex) =>
    guardBlock(block, `blocks[${blockIndex}]`, actions),
  );

  return {
    result: {
      ...extraction,
      blocks,
      workoutNotes: extraction.workoutNotes.map((note, index) =>
        enforceConfidence(note, `workoutNotes[${index}]`, actions),
      ),
    },
    actions,
  };
}

function guardBlock(
  block: RawExtractedBlock,
  path: string,
  actions: GuardrailAction[],
): RawExtractedBlock {
  const guarded: RawExtractedBlock = {
    ...block,
    exercises: block.exercises.map((exercise, index) =>
      guardExercise(exercise, `${path}.exercises[${index}]`, actions),
    ),
  };

  // Rounds and round-rest are prescriptions too, and are subject to the same rule.
  for (const key of ['rounds', 'restBetweenRoundsSeconds', 'capSeconds'] as const) {
    const field = guarded[key];
    if (!field) continue;
    const cleaned = guardQuantitative(field, `${path}.${key}`, actions);
    if (cleaned === undefined) delete guarded[key];
    else guarded[key] = cleaned;
  }

  return guarded;
}

function guardExercise(
  exercise: RawExtractedExercise,
  path: string,
  actions: GuardrailAction[],
): RawExtractedExercise {
  const guarded: RawExtractedExercise = { ...exercise };

  // The NAME is the one thing visual identification is allowed to supply (PRD §3.2).
  guarded.name = enforceConfidence(exercise.name, `${path}.name`, actions);

  for (const key of QUANTITATIVE_FIELDS) {
    const field = guarded[key];
    if (!field) continue;
    const cleaned = guardQuantitative(field, `${path}.${key}`, actions);
    if (cleaned === undefined) delete guarded[key];
    else guarded[key] = cleaned;
  }

  for (const key of PRESCRIPTIVE_TEXT_FIELDS) {
    const field = guarded[key];
    if (!field) continue;
    const cleaned = guardPrescriptiveText(field, `${path}.${key}`, actions);
    if (cleaned === undefined) delete guarded[key];
    else guarded[key] = cleaned;
  }

  guarded.formCues = filterCreatorAuthored(exercise.formCues, `${path}.formCues`, actions);
  guarded.notes = filterCreatorAuthored(exercise.notes, `${path}.notes`, actions);

  return guarded;
}

/**
 * Strip a numeric field that no creator statement supports. Returns undefined when
 * the field should be dropped entirely — the UI then shows "Not specified", which is
 * the honest answer.
 */
function guardQuantitative(
  field: ExtractedField<number>,
  path: string,
  actions: GuardrailAction[],
): ExtractedField<number> | undefined {
  if (field.value === null) return field;

  if (!CREATOR_SOURCES.includes(field.source)) {
    actions.push({
      action: 'stripped',
      path,
      reason: `A prescription cannot come from ${field.source}; the creator never stated it.`,
    });
    return undefined;
  }

  return enforceConfidence(field, path, actions);
}

function guardPrescriptiveText(
  field: ExtractedField<string>,
  path: string,
  actions: GuardrailAction[],
): ExtractedField<string> | undefined {
  if (field.value === null) return field;

  if (!CREATOR_SOURCES.includes(field.source)) {
    actions.push({
      action: 'stripped',
      path,
      reason: `Load and resistance cannot be inferred from ${field.source}.`,
    });
    return undefined;
  }

  return enforceConfidence(field, path, actions);
}

/**
 * Coaching text must be the creator's. AI-authored cues would be presented next to
 * the creator's name, which would misrepresent them (PRD §3.3, §15, §32).
 */
function filterCreatorAuthored(
  fields: ExtractedField<string>[],
  path: string,
  actions: GuardrailAction[],
): ExtractedField<string>[] {
  const kept: ExtractedField<string>[] = [];

  fields.forEach((field, index) => {
    if (field.value === null) return;
    if (!CREATOR_SOURCES.includes(field.source)) {
      actions.push({
        action: 'stripped',
        path: `${path}[${index}]`,
        reason: 'Coaching text must come from the creator, not from AI inference.',
      });
      return;
    }
    kept.push(enforceConfidence(field, `${path}[${index}]`, actions));
  });

  return kept;
}

/** Rule 2: a shaky value is shown as "Unclear ⚠️", never asserted (PRD §9). */
function enforceConfidence<T>(
  field: ExtractedField<T>,
  path: string,
  actions: GuardrailAction[],
): ExtractedField<T> {
  if (field.value === null) return field;
  if (field.confidence === undefined) return field;
  if (field.confidence >= REVIEW_CONFIDENCE_THRESHOLD) return field;
  if (field.needsReview) return field;

  actions.push({
    action: 'flagged_for_review',
    path,
    reason: `Confidence ${field.confidence.toFixed(2)} is below ${REVIEW_CONFIDENCE_THRESHOLD}.`,
  });
  return { ...field, needsReview: true };
}
