import { describe, expect, it } from 'vitest';
import { applyGuardrails } from './guardrails';
import { extracted } from '../schema/provenance';
import type { StructuredWorkoutExtraction } from '../schema/extraction';

/**
 * These tests are the enforcement of "Extract, Don't Invent" (PRD §3.1, §21).
 * They describe what the system does when a model misbehaves — which is the case
 * that matters, since a well-behaved model needs no guardrail.
 */

function extractionWith(exercise: StructuredWorkoutExtraction['blocks'][number]['exercises'][number]) {
  return {
    title: 'Test',
    structure: 'straight_sets',
    blocks: [{ kind: 'straight_sets', exercises: [exercise] }],
    workoutNotes: [],
    detectedMovements: [],
  } satisfies StructuredWorkoutExtraction;
}

describe('guardrails', () => {
  it('allows a movement NAME to come from visual identification', () => {
    // PRD §3.2: the creator silently demonstrates an RDL; we may name it.
    const { result, actions } = applyGuardrails(
      extractionWith({
        name: extracted('Romanian Deadlift', 'visual_identification', 0.91),
        formCues: [],
        notes: [],
      }),
    );

    expect(result.blocks[0]!.exercises[0]!.name.value).toBe('Romanian Deadlift');
    expect(actions.filter((a) => a.action === 'stripped')).toHaveLength(0);
  });

  it('strips a PRESCRIPTION that came from visual identification', () => {
    // PRD §3.2: "AI should NOT infer 3 sets × 10 reps" from watching.
    const { result, actions } = applyGuardrails(
      extractionWith({
        name: extracted('Romanian Deadlift', 'visual_identification', 0.91),
        sets: extracted(3, 'visual_identification', 0.88),
        reps: extracted(10, 'visual_identification', 0.85),
        formCues: [],
        notes: [],
      }),
    );

    const exercise = result.blocks[0]!.exercises[0]!;
    expect(exercise.sets).toBeUndefined();
    expect(exercise.reps).toBeUndefined();
    expect(actions.filter((a) => a.action === 'stripped')).toHaveLength(2);
    expect(actions[0]!.reason).toContain('the creator never stated it');
  });

  it('keeps a prescription the creator actually spoke', () => {
    const { result } = applyGuardrails(
      extractionWith({
        name: extracted('Hip Thrust', 'speech', 0.9),
        sets: extracted(3, 'speech', 0.92),
        reps: extracted(15, 'onscreen_text', 0.9),
        formCues: [],
        notes: [],
      }),
    );

    const exercise = result.blocks[0]!.exercises[0]!;
    expect(exercise.sets?.value).toBe(3);
    expect(exercise.reps?.value).toBe(15);
  });

  it('removes AI-authored form cues', () => {
    // PRD §21/§32: the app does not generate coaching, and must never present
    // AI text under the creator's name.
    const { result, actions } = applyGuardrails(
      extractionWith({
        name: extracted('Goblet Squat', 'visual_identification', 0.9),
        formCues: [
          extracted('Keep your chest up.', 'speech', 0.9),
          extracted('Consider reducing depth if you have knee pain.', 'visual_identification', 0.8),
        ],
        notes: [],
      }),
    );

    const cues = result.blocks[0]!.exercises[0]!.formCues;
    expect(cues).toHaveLength(1);
    expect(cues[0]!.value).toBe('Keep your chest up.');
    expect(actions.some((a) => a.reason.includes('must come from the creator'))).toBe(true);
  });

  it('flags low-confidence values for review instead of dropping them', () => {
    // PRD §9: "12 reps" or "20 reps"? Keep it, mark it Unclear, let the user check.
    const { result, actions } = applyGuardrails(
      extractionWith({
        name: extracted('Bicycle Crunch', 'speech', 0.92),
        reps: { value: 12, source: 'speech', confidence: 0.61, needsReview: false },
        formCues: [],
        notes: [],
      }),
    );

    const reps = result.blocks[0]!.exercises[0]!.reps;
    expect(reps?.value).toBe(12);
    expect(reps?.needsReview).toBe(true);
    expect(actions.some((a) => a.action === 'flagged_for_review')).toBe(true);
  });

  it('applies the same rule to block-level rounds and rest', () => {
    const { result } = applyGuardrails({
      title: 'Test',
      structure: 'circuit',
      blocks: [
        {
          kind: 'circuit',
          rounds: extracted(4, 'visual_identification', 0.9),
          restBetweenRoundsSeconds: extracted(60, 'speech', 0.9),
          exercises: [{ name: extracted('Burpee', 'speech', 0.9), formCues: [], notes: [] }],
        },
      ],
      workoutNotes: [],
      detectedMovements: [],
    });

    // Counting rounds by watching is still inventing a prescription.
    expect(result.blocks[0]!.rounds).toBeUndefined();
    expect(result.blocks[0]!.restBetweenRoundsSeconds?.value).toBe(60);
  });
});
