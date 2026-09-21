# Schema notes

The structured workout and extraction schema (PRD §11), and why it is shaped this way.

## ExtractedField<T> — the unit of trust

```ts
type ExtractedField<T> = {
  value: T | null;
  source: 'speech' | 'onscreen_text' | 'caption' | 'visual_identification' | 'user';
  confidence?: number;
  needsReview: boolean;
  supersedes?: ExtractedField<T>;   // what a user edit replaced
};
```

Every extracted value is wrapped. `12` is not a fact the product can use — *"12, heard
in speech, confidence 0.61"* is, because only the second can be rendered honestly.

Four display states fall out of it (`fieldStatus`):

| Status | Condition | UI |
|---|---|---|
| `specified` | value present, confident | `12 reps` |
| `unclear` | value present, confidence < 0.75 | `Reps: Unclear ⚠️` |
| `not_specified` | value is null | `Reps: Not specified` |
| `user_set` | source is `user` | `12 reps` + `Edited` |

`supersedes` is what makes a correction non-destructive. Repeated edits keep the
**original** creator value, not the previous edit — otherwise the edit-rate metric
decays into noise after the second tap. There is a test pinning exactly this.

## Why there is no `defaultTo`

There is no helper anywhere in this codebase that fills in a plausible value. The only
way to get a number into a field is for a source to have supplied it or a user to have
typed it. `notSpecified()` is the honest alternative, and it renders as
"Not specified" rather than being hidden.

## Workout → Blocks → WorkoutExercise → Exercise

```
Workout
  └─ WorkoutBlock         kind, rounds, restBetweenRounds
       └─ WorkoutExercise  the PRESCRIPTION: sets/reps/duration/rest/cues
            └─ Exercise    the MOVEMENT: id, slug, displayName  (shared, deduped)
```

`Exercise` is separate on purpose (PRD §27). "Bulgarian Split Squat" imported from
three creators is one catalog row keyed by slug. The prescription belongs to the
workout; the movement does not. That is what later allows shared demo media, muscle
groups, and cross-workout history without a migration.

## Block kinds and what drives repetition

| kind | Repetition comes from | Rest is taken |
|---|---|---|
| `straight_sets` | each exercise's `sets` | after each set |
| `circuit`, `superset`, `interval`, `amrap`, `emom`, `flow` | the block's `rounds` | after the round |

This single table is the difference between the §41 acceptance test passing and
failing. It is implemented in one place: `compilePlan`.

`Workout.structure` is retained as a *summary label* for display and future filtering.
`blocks` is the executable truth. When they disagree, blocks win.

## Rounds and sets default to 1 — is that inventing?

No. `blockRounds()` and `exerciseSets()` floor at 1 because performing a block zero
times is not a coherent reading of "do this block". The field itself stays
`not_specified`, so the UI still says so and never attributes "1 round" to the creator.
The default exists only so the compiler can produce a runnable plan.

## Step ids are stable and content-derived

`${blockId}:${exerciseId}:r${round}:s${set}` — so session progress is keyed by
something that survives serialization and does not shift if the plan is recompiled.
Progress is stored keyed by step id rather than by index for exactly this reason.

## Persistence

Schemas are Zod, so storage reads are validated on the way out. A record written by an
older app version is skipped, not fatal — the library screen renders what it can
understand rather than crashing on launch. There is a test for this.
