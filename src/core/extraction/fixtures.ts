import { extracted, notSpecified } from '../schema/provenance';
import type { StructuredWorkoutExtraction } from '../schema/extraction';

/**
 * Representative extractions used by MockExtractionService.
 *
 * These ship in the product build on purpose. They make the whole flow —
 * import → review → edit → save → execute — demoable and testable with zero
 * credentials configured, which is what lets Milestones 1–3 be finished and verified
 * before any model is wired up (PRD §40).
 *
 * Each fixture encodes a specific PRD requirement, noted above it.
 */

/**
 * PRD §41, the required acceptance scenario.
 *
 * "Do three rounds. Ten Bulgarian split squats each side, 12 RDLs, and a 45-second
 *  wall sit. Rest for one minute after each round. Keep your torso slightly forward
 *  on the split squats."
 *
 * Note what is present and what is absent. Rounds, reps and rest are all stated by
 * the creator, so they carry `speech` provenance. Nothing else is filled in.
 */
export const LEG_DAY_CIRCUIT: StructuredWorkoutExtraction = {
  title: '20-Minute Leg Day',
  structure: 'circuit',
  blocks: [
    {
      kind: 'circuit',
      rounds: extracted(3, 'speech', 0.96),
      restBetweenRoundsSeconds: extracted(60, 'speech', 0.94),
      exercises: [
        {
          name: extracted('Bulgarian Split Squat', 'speech', 0.95),
          repsPerSide: extracted(10, 'speech', 0.93),
          formCues: [extracted('Keep your torso slightly forward.', 'speech', 0.92)],
          notes: [],
        },
        {
          // The creator said "RDLs"; the movement is confirmed visually. The NAME may
          // come from visual identification — the prescription may not.
          name: extracted('Romanian Deadlift', 'speech', 0.89),
          reps: extracted(12, 'speech', 0.91),
          formCues: [],
          notes: [],
        },
        {
          name: extracted('Wall Sit', 'speech', 0.94),
          durationSeconds: extracted(45, 'speech', 0.95),
          formCues: [],
          notes: [],
        },
      ],
    },
  ],
  workoutNotes: [],
  detectedMovements: ['Bulgarian Split Squat', 'Romanian Deadlift', 'Wall Sit'],
};

/**
 * PRD §8 — exercises demonstrated with no prescription whatsoever.
 * The workout is still created. Every quantity reads "Not specified", and the user
 * fills them in. Nothing is guessed.
 */
export const HIP_MOBILITY_FLOW: StructuredWorkoutExtraction = {
  title: 'Hip Mobility Routine',
  structure: 'flow',
  blocks: [
    {
      kind: 'flow',
      exercises: [
        {
          name: extracted('Hip Flexor Stretch', 'visual_identification', 0.86),
          formCues: [],
          notes: [],
        },
        {
          name: extracted('90/90 Hip Rotation', 'visual_identification', 0.83),
          formCues: [],
          notes: [],
        },
        {
          name: extracted("World's Greatest Stretch", 'visual_identification', 0.81),
          formCues: [],
          notes: [],
        },
        {
          name: extracted('Deep Squat Hold', 'visual_identification', 0.88),
          formCues: [],
          notes: [],
        },
      ],
    },
  ],
  workoutNotes: [extracted('Four exercises I use for hip mobility.', 'caption', 0.9)],
  detectedMovements: [
    'Hip Flexor Stretch',
    '90/90 Hip Rotation',
    "World's Greatest Stretch",
    'Deep Squat Hold',
  ],
};

/**
 * PRD §9 — the creator said either "12 reps" or "20 reps" and we genuinely cannot
 * tell. The value is kept but flagged, so the review screen shows "Unclear ⚠️" and
 * offers Review Original instead of silently committing to one reading.
 */
export const AMBIGUOUS_CORE_CIRCUIT: StructuredWorkoutExtraction = {
  title: '10-Minute Ab Routine',
  structure: 'circuit',
  blocks: [
    {
      kind: 'circuit',
      rounds: extracted(3, 'onscreen_text', 0.88),
      exercises: [
        {
          name: extracted('Hollow Body Hold', 'speech', 0.9),
          durationSeconds: extracted(30, 'onscreen_text', 0.87),
          formCues: [],
          notes: [],
        },
        {
          name: extracted('Bicycle Crunch', 'speech', 0.92),
          // Low confidence: the audio was ambiguous between 12 and 20.
          reps: extracted(12, 'speech', 0.61),
          formCues: [],
          notes: [],
        },
        {
          name: extracted('Plank', 'visual_identification', 0.94),
          // Demonstrated, but no duration was ever stated.
          durationSeconds: notSpecified<number>('speech'),
          formCues: [],
          notes: [],
        },
      ],
    },
  ],
  workoutNotes: [],
  detectedMovements: ['Hollow Body Hold', 'Bicycle Crunch', 'Plank'],
};

/**
 * PRD §7 / §16 — straight sets, so repetition comes from each exercise's own `sets`
 * and rest is taken between sets. Contrast with the circuit fixture above.
 */
export const UPPER_BODY_STRAIGHT_SETS: StructuredWorkoutExtraction = {
  title: 'Push Day Strength',
  structure: 'straight_sets',
  blocks: [
    {
      kind: 'straight_sets',
      exercises: [
        {
          name: extracted('Dumbbell Bench Press', 'speech', 0.93),
          sets: extracted(4, 'speech', 0.92),
          reps: extracted(8, 'speech', 0.9),
          restSeconds: extracted(90, 'speech', 0.88),
          weight: extracted('Whatever you can control for 8', 'speech', 0.8),
          formCues: [extracted('Keep your elbows at about 45 degrees.', 'speech', 0.86)],
          notes: [],
        },
        {
          name: extracted('Overhead Press', 'speech', 0.91),
          sets: extracted(3, 'speech', 0.9),
          reps: extracted(10, 'speech', 0.89),
          restSeconds: extracted(60, 'speech', 0.87),
          formCues: [],
          notes: [],
        },
      ],
    },
  ],
  workoutNotes: [],
  detectedMovements: ['Dumbbell Bench Press', 'Overhead Press'],
};

export const FIXTURES = {
  legDayCircuit: LEG_DAY_CIRCUIT,
  hipMobilityFlow: HIP_MOBILITY_FLOW,
  ambiguousCore: AMBIGUOUS_CORE_CIRCUIT,
  upperBodyStraightSets: UPPER_BODY_STRAIGHT_SETS,
} as const;

export type FixtureKey = keyof typeof FIXTURES;
export const FIXTURE_KEYS = Object.keys(FIXTURES) as FixtureKey[];
