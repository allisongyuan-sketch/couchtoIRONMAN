import { z } from 'zod';
import {
  exerciseSchema,
  workoutSchema,
  type Exercise,
  type Workout,
} from '@/core/schema/workout';
import { extractionSchema, type Extraction } from '@/core/schema/extraction';
import { workoutSessionSchema, type SessionSummary, type WorkoutSession } from '@/core/schema/session';
import type { KeyValueStore } from './keyValueStore';

/**
 * Local-first repositories.
 *
 * Everything the user creates lives on the device first, with no user id threaded
 * through it. That is what makes "try first, account later" (PRD §26) an
 * architectural property rather than a feature to retrofit: signing in later means
 * syncing this data up, not restructuring it.
 *
 * Reads are validated on the way out. Storage is the one place where data can arrive
 * from a previous app version, so a shape change degrades to "that record is skipped"
 * rather than a crash on launch.
 */

const KEYS = {
  workouts: 'repurpose:workouts:v1',
  exercises: 'repurpose:exercises:v1',
  extractions: 'repurpose:extractions:v1',
  activeSession: 'repurpose:session:active:v1',
  history: 'repurpose:history:v1',
  onboarded: 'repurpose:onboarded:v1',
} as const;

async function readCollection<T>(
  store: KeyValueStore,
  key: string,
  schema: z.ZodType<T>,
): Promise<T[]> {
  const raw = await store.getItem(key);
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    // Drop unreadable records instead of failing the whole read.
    return parsed.flatMap((entry) => {
      const result = schema.safeParse(entry);
      return result.success ? [result.data] : [];
    });
  } catch {
    return [];
  }
}

async function writeCollection<T>(store: KeyValueStore, key: string, items: T[]): Promise<void> {
  await store.setItem(key, JSON.stringify(items));
}

/* --------------------------------- workouts -------------------------------- */

export interface WorkoutRepository {
  list(): Promise<Workout[]>;
  get(id: string): Promise<Workout | null>;
  save(workout: Workout): Promise<void>;
  remove(id: string): Promise<void>;
}

export function createWorkoutRepository(store: KeyValueStore): WorkoutRepository {
  return {
    async list() {
      const workouts = await readCollection(store, KEYS.workouts, workoutSchema);
      return workouts.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    },
    async get(id) {
      const workouts = await readCollection(store, KEYS.workouts, workoutSchema);
      return workouts.find((workout) => workout.id === id) ?? null;
    },
    async save(workout) {
      const workouts = await readCollection(store, KEYS.workouts, workoutSchema);
      const index = workouts.findIndex((entry) => entry.id === workout.id);
      if (index >= 0) workouts[index] = workout;
      else workouts.push(workout);
      await writeCollection(store, KEYS.workouts, workouts);
    },
    async remove(id) {
      const workouts = await readCollection(store, KEYS.workouts, workoutSchema);
      await writeCollection(
        store,
        KEYS.workouts,
        workouts.filter((workout) => workout.id !== id),
      );
    },
  };
}

/* ----------------------------- exercise catalog ---------------------------- */

export interface ExerciseCatalogRepository {
  list(): Promise<Exercise[]>;
  upsertMany(exercises: Exercise[]): Promise<void>;
  findBySlug(slug: string): Promise<Exercise | null>;
}

/**
 * The shared movement catalog. Deduped by slug so that "Bulgarian Split Squat"
 * imported from three different creators is one entity (PRD §27) — which is what
 * makes shared demo media and cross-workout history possible later.
 */
export function createExerciseCatalogRepository(store: KeyValueStore): ExerciseCatalogRepository {
  return {
    async list() {
      return readCollection(store, KEYS.exercises, exerciseSchema);
    },
    async upsertMany(exercises) {
      const existing = await readCollection(store, KEYS.exercises, exerciseSchema);
      const bySlug = new Map(existing.map((exercise) => [exercise.slug, exercise]));
      for (const exercise of exercises) {
        if (!bySlug.has(exercise.slug)) bySlug.set(exercise.slug, exercise);
      }
      await writeCollection(store, KEYS.exercises, [...bySlug.values()]);
    },
    async findBySlug(slug) {
      const existing = await readCollection(store, KEYS.exercises, exerciseSchema);
      return existing.find((exercise) => exercise.slug === slug) ?? null;
    },
  };
}

/* -------------------------------- extractions ------------------------------ */

export interface ExtractionRepository {
  get(id: string): Promise<Extraction | null>;
  save(extraction: Extraction): Promise<void>;
}

/** Kept separate from workouts so user edits never overwrite what the AI produced. */
export function createExtractionRepository(store: KeyValueStore): ExtractionRepository {
  return {
    async get(id) {
      const all = await readCollection(store, KEYS.extractions, extractionSchema);
      return all.find((extraction) => extraction.id === id) ?? null;
    },
    async save(extraction) {
      const all = await readCollection(store, KEYS.extractions, extractionSchema);
      const index = all.findIndex((entry) => entry.id === extraction.id);
      if (index >= 0) all[index] = extraction;
      else all.push(extraction);
      // Bounded: extractions are diagnostic, not user content.
      await writeCollection(store, KEYS.extractions, all.slice(-100));
    },
  };
}

/* --------------------------------- sessions -------------------------------- */

const sessionSummarySchema = z.object({
  sessionId: z.string(),
  workoutId: z.string(),
  workoutTitle: z.string(),
  creatorHandle: z.string().optional(),
  completedAt: z.number(),
  durationSeconds: z.number(),
  exercisesCompleted: z.number(),
  exercisesTotal: z.number(),
});

export interface SessionRepository {
  /** The in-progress workout, if any. Restored on launch (PRD §23). */
  getActive(): Promise<WorkoutSession | null>;
  saveActive(session: WorkoutSession): Promise<void>;
  clearActive(): Promise<void>;
  listHistory(): Promise<SessionSummary[]>;
  appendHistory(summary: SessionSummary): Promise<void>;
}

export function createSessionRepository(store: KeyValueStore): SessionRepository {
  return {
    async getActive() {
      const raw = await store.getItem(KEYS.activeSession);
      if (!raw) return null;
      try {
        const parsed = workoutSessionSchema.safeParse(JSON.parse(raw));
        return parsed.success ? parsed.data : null;
      } catch {
        return null;
      }
    },
    async saveActive(session) {
      await store.setItem(KEYS.activeSession, JSON.stringify(session));
    },
    async clearActive() {
      await store.removeItem(KEYS.activeSession);
    },
    async listHistory() {
      const history = await readCollection(store, KEYS.history, sessionSummarySchema);
      return history.sort((a, b) => b.completedAt - a.completedAt);
    },
    async appendHistory(summary) {
      const history = await readCollection(store, KEYS.history, sessionSummarySchema);
      await writeCollection(store, KEYS.history, [...history, summary]);
    },
  };
}

/* ------------------------------- preferences ------------------------------- */

export interface PreferencesRepository {
  hasOnboarded(): Promise<boolean>;
  setOnboarded(value: boolean): Promise<void>;
}

export function createPreferencesRepository(store: KeyValueStore): PreferencesRepository {
  return {
    async hasOnboarded() {
      return (await store.getItem(KEYS.onboarded)) === 'true';
    },
    async setOnboarded(value) {
      await store.setItem(KEYS.onboarded, String(value));
    },
  };
}

export interface Repositories {
  workouts: WorkoutRepository;
  exercises: ExerciseCatalogRepository;
  extractions: ExtractionRepository;
  sessions: SessionRepository;
  preferences: PreferencesRepository;
}

export function createRepositories(store: KeyValueStore): Repositories {
  return {
    workouts: createWorkoutRepository(store),
    exercises: createExerciseCatalogRepository(store),
    extractions: createExtractionRepository(store),
    sessions: createSessionRepository(store),
    preferences: createPreferencesRepository(store),
  };
}
