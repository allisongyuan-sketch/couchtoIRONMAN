# Repurpose — Architecture

> Status: MVP / V1. This document is the contract between the PRD and the code.
> If an implementation detail contradicts this file, one of the two is wrong — fix it.

## 0. The one sentence

Repurpose turns short-form fitness video into an **executable workout**:
`WATCHABLE CONTENT → STRUCTURED WORKOUT → INTERACTIVE EXECUTION`.

Everything below exists to keep those three stages **independently replaceable**.

---

## 1. Technical uncertainties (named up front)

| # | Uncertainty | Why it matters | How the architecture absorbs it |
|---|---|---|---|
| U1 | **Arbitrary TikTok/IG media cannot be reliably downloaded.** Terms of service, auth walls, rotating CDN tokens, and regional blocks all apply. | This is the single biggest existential risk to the core promise. | `ContentIngestionProvider` registry (§7). Ingestion returns a **capability report**, not a file. Every provider may legally return `media_unavailable`, and the product still works via upload/manual fallback. |
| U2 | **Multimodal extraction quality is unknown** and vendor-dependent. | Bad extraction destroys trust faster than slow extraction. | `WorkoutExtractionService` abstraction (§8) + a **guardrail pass** that mechanically deletes unsupported prescriptions the model may have invented. Provenance is enforced by code, not by prompt discipline alone. |
| U3 | **Share-sheet ingestion differs per platform** and needs native config + a dev build (not Expo Go). | Milestone 5 can't be done in a managed-workflow vacuum. | Share intent is modeled as *just another ingestion input*. The app's import flow never assumes it was reached via share sheet. |
| U4 | **Structure recognition ("3 rounds, back-to-back") is a reasoning problem**, not a parsing problem. | The acceptance test in PRD §41 depends on it. | Workout is a tree of **blocks** (§5), not a flat exercise list. The circuit is a first-class datatype, so the model only has to *label* structure, not invent execution semantics. |
| U5 | **Costs scale per import**, not per user. | Monetization/entitlements later. | Entitlement checks sit at the **import boundary** only (§11). Nothing else in the app knows about billing. |
| U6 | **Timers in RN are unreliable across backgrounding.** | A rest timer that drifts while the phone locks is a broken product. | Timers are **deadline-based, not tick-based** (§6.4). State stores `endsAt`; the UI derives remaining time from wall clock. |

---

## 2. Architectural shape

The governing rule: **the core is pure TypeScript with zero React Native imports.**

```
repurpose/
├── app/                      Expo Router routes. Thin. Screens compose, never decide.
├── src/
│   ├── core/                 ← PURE. No RN, no Expo, no network. 100% unit-testable.
│   │   ├── schema/           Zod schemas + provenance types (the lingua franca)
│   │   ├── engine/           Execution engine: plan compiler + session state machine
│   │   ├── ingestion/        ContentIngestionProvider registry + providers
│   │   ├── extraction/       WorkoutExtractionService + guardrails + mock/LLM impls
│   │   ├── editing/          Pure workout mutation ops (used by the editor UI)
│   │   ├── analytics/        Event taxonomy + Tracker port
│   │   └── entitlements/     Entitlement port (stubbed, but wired at the boundary)
│   ├── data/                 Repository ports + local (AsyncStorage) adapters
│   ├── state/                Zustand stores. Bind core → UI. No business logic.
│   └── ui/                   Design system: tokens + primitives
├── supabase/migrations/      Postgres schema (§4). Not required to run the MVP.
└── docs/                     This file, SCHEMA.md, MILESTONES.md, DECISIONS.md
```

### Why "pure core" is the load-bearing decision

Everything expensive to get right — provenance, execution semantics, circuit repetition,
timer math, guardrails — lives in `src/core` and is tested in Node with no simulator.
That means:

* the workout engine can be reused by an Apple Watch app, a web app, or a server-side
  renderer **without a rewrite** (PRD §36);
* AI vendors, ingestion strategies, and the persistence layer are swappable;
* the UI can be redesigned entirely without touching a single business rule.

**Dependency rule:** `app/` → `state/` → `core/` + `data/`. Arrows never reverse.
`core/` imports nothing from the other three. This is enforced by review and by the
fact that `core/` is exercised by tests that never load React.

---

## 3. Data model

Entities (PRD §27), and the deliberate joins between them:

```
User
 └─ SourceContent        the original Reel/Short/TikTok. Immutable record of provenance.
     └─ Extraction       one AI run over one SourceContent. Versioned, auditable.
         └─ Workout      the structured, user-editable result.
             └─ WorkoutBlock       circuit / straight sets / interval …
                 └─ WorkoutExercise   a *prescription* (sets/reps/duration/rest)
                     └─ Exercise       the *movement* — shared, reusable, deduped
                                       by canonical slug. NOT owned by a workout.
└─ WorkoutSession        one attempt at one workout.
    └─ WorkoutSessionStep   one executed step, with completed/skipped and timings.
```

Two joins matter most:

1. **`WorkoutExercise` is separate from `Exercise`.** PRD §27 is explicit: do not couple
   exercises to one workout. "Bulgarian Split Squat" is a movement that will eventually
   carry demo media, muscle groups, and cues shared across every workout that uses it.
   The prescription (`3 × 10/side`) belongs to the workout; the movement does not.
2. **`Extraction` is preserved separately from `Workout`.** User edits mutate the
   workout; the original extraction stays intact. That is what makes
   *extraction edit rate* (PRD §29/§30) measurable — we can diff the two — and it is
   what lets us re-run extraction later without destroying user corrections.

Full DDL: `supabase/migrations/0001_init.sql`. Schema notes: `docs/SCHEMA.md`.

---

## 4. Provenance: the product's spine

PRD §3.1, §3.2, §3.3, §21 all reduce to one type:

```ts
type ExtractedField<T> = {
  value: T | null;
  source: 'speech' | 'onscreen_text' | 'caption' | 'visual_identification' | 'user';
  confidence?: number;
  needsReview: boolean;
};
```

Three rules, enforced in `core/extraction/guardrails.ts` — **in code, not in the prompt**:

1. **Quantitative fields may never originate from `visual_identification`.** You can see
   *that* someone is doing a Romanian deadlift. You cannot see *that they prescribed 3×10*.
   Any numeric field arriving with that source is stripped to `notSpecified()`.
2. **Low confidence (< 0.75) forces `needsReview: true`.** Renders as `Unclear ⚠️`.
3. **Missing means missing.** `value: null` renders as `Not specified` — never as a
   plausible default. There is no code path that writes a number the source didn't supply.

A user edit rewrites a field with `source: 'user'`, `confidence: 1`, `needsReview: false`,
and stashes the prior field in `supersedes` — so creator intent survives the override and
the correction remains measurable.

---

## 5. Workout structure = blocks, not a flat list

A flat `Exercise[]` cannot express *"these three, back-to-back, four rounds"*. So:

```ts
Workout.blocks: WorkoutBlock[]
WorkoutBlock = {
  kind: 'straight_sets' | 'circuit' | 'superset' | 'interval' | 'amrap' | 'emom' | 'flow';
  rounds?: ExtractedField<number>;          // circuit/superset: how many times through
  restBetweenRoundsSeconds?: ExtractedField<number>;
  exercises: WorkoutExercise[];
}
```

This is the key to PRD §22 and §41. A circuit is *one block with rounds=3*, not three
exercises that each coincidentally say "3 sets". The distinction is load-bearing at
execution time: a circuit rests **after the round**, straight sets rest **after each set**.

`WorkoutStructure` (the PRD's top-level enum) is retained on the workout as a **summary
label** for display and future filtering; blocks are the executable truth.

---

## 6. Execution engine

Two pure pieces, in `src/core/engine/`.

### 6.1 The compiler — `compilePlan(workout) → ExecutionPlan`

Flattens the block tree into an ordered, immutable list of **steps**:

```ts
type Step =
  | { kind: 'exercise_set'; ... reps | repsPerSide | durationSeconds ... }
  | { kind: 'rest'; durationSeconds; reason: 'between_sets' | 'between_rounds' | 'between_exercises' }
```

Each step carries denormalized display data (exercise name, `set 2 of 3`, `round 1 of 3`,
creator cues) so the player never re-derives anything mid-workout.

Compiling ahead of time — rather than computing "what's next" on the fly — is what makes
progress, seeking, resume-after-kill, and `Previous` trivially correct.

**Rest is only emitted when the creator specified it.** No rest step is invented (§21).

### 6.2 The state machine — `sessionReducer(state, event) → state`

```
events: START | COMPLETE_STEP | SKIP_STEP | PREVIOUS | START_TIMER | PAUSE | RESUME
      | ADD_TIME | TICK | FINISH | ABANDON
```

A plain reducer over a serializable `SessionState`. Pure ⇒ exhaustively unit-testable
⇒ the acceptance test in PRD §41 is a *test file*, not a manual QA script.

### 6.3 Auto-advance
Timed steps and rest steps advance automatically at zero. Rep-based steps require
`COMPLETE SET` (PRD §14). The engine exposes this as `step.requiresManualCompletion`,
so adding wearable rep-detection later means flipping that flag — not rewriting the player.

### 6.4 Timers are deadlines, not ticks
State stores `timer: { endsAt, remainingWhenPaused }`. The UI ticks only to re-render;
correctness comes from `Date.now()`. Backgrounding the app, locking the phone, or a
dropped interval cannot desynchronize a rest timer.

### 6.5 Persistence
`SessionState` is a plain serializable object, snapshotted to local storage on every
event. Killing the app mid-workout loses nothing (PRD §23).

---

## 7. Ingestion abstraction

```ts
interface ContentIngestionProvider {
  readonly id: string;
  canHandle(url: string): boolean;
  ingest(input: IngestionInput): Promise<IngestionResult>;
}
```

`IngestionResult` is a **discriminated union**, and degradation is a first-class outcome:

```ts
| { status: 'ok';                 source, media }          // analyzable media in hand
| { status: 'metadata_only';      source, reason }         // attribution yes, media no
| { status: 'unsupported_source'; url }
| { status: 'failed';             reason, retryable }
```

`metadata_only` is the important one. It is **not an error** — we still have the creator,
the URL, and the thumbnail, so we can show correct attribution while routing the user to
*Upload Video* / *Enter Manually* (PRD §19, §31). The application never assumes it can
download a video.

Providers registered for MVP: TikTok, Instagram, YouTube (URL recognition + metadata),
plus `upload` and a `manual` escape hatch. Swapping in a real media pipeline later means
adding one provider — no screen changes.

---

## 8. AI extraction abstraction

```ts
interface WorkoutExtractionService {
  readonly id: string;
  extractWorkout(media: ProcessedMedia, opts): Promise<StructuredWorkoutExtraction>;
}
```

Pipeline (PRD §20), each stage independently replaceable:

```
IngestionResult → ProcessedMedia (transcript + on-screen text + captions + visual labels)
   → WorkoutExtractionService  (vendor-specific; the only stage that knows a model exists)
   → Zod schema validation     (reject malformed output, retry once)
   → Guardrail pass            (strip invented prescriptions — §4)
   → Confidence evaluation     (set needsReview flags)
   → Review UI
```

Implementations:
* **`MockExtractionService`** — deterministic fixtures, including the PRD §41 scenario, a
  no-prescription mobility routine, an ambiguous-reps case, and a failure case. Ships in
  the product build so the full flow is demoable and testable with zero credentials.
* **`RemoteExtractionService`** — the real one. Posts evidence to our own endpoint and
  returns the outcome. Contains no prompt, no model name and no credential.

Selection is one ternary in `src/state/container.ts`, driven by whether an endpoint URL
is configured. No screen, store or test outside that file knows which is running.

### Why extraction runs on a server

**An API key shipped in a React Native bundle is extractable from the app binary.** There
is no obfuscation that fixes this, and `EXPO_PUBLIC_` variables are inlined into the
bundle by design — so no credential may ever live in app config. The device therefore
posts evidence to an endpoint we control, and that endpoint holds the key:

```
device                          our server                    Anthropic
  │  POST /api/extract             │                              │
  │  { frames, transcript, … }     │                              │
  ├───────────────────────────────►│  messages.parse(...)         │
  │                                ├─────────────────────────────►│
  │  { status, result }            │                              │
  │◄───────────────────────────────┤                              │
```

`app/api/extract+api.ts` is a two-line binding onto `src/server/extractHandler.ts` —
everything under `app/` is a route, so the handler lives where it can be imported and
tested. It is the reference implementation; a team with an existing backend serves the
same contract from there and points the client's endpoint URL at it.

### What the model is and is not allowed to say

The wire contract (`src/core/extraction/wire.ts`) is deliberately **not** the domain
schema. It is flat, fully-required and closed, because that is what structured outputs
need — and because "not specified" is far harder to get wrong as `value: null` on a
present field than as an omitted key.

Two things are withheld from the model on purpose:

* **`needsReview`** is not in the wire schema. Review status is derived from confidence
  by `extracted()`, in one place, so the threshold cannot drift per response.
* **`source: 'user'`** is not in the wire enum. Only an actual human edit may claim it;
  otherwise a fabricated value could render as the user's own correction.

Guardrails then run on the **client**, inside `runExtractionPipeline`, not on the server.
That placement is deliberate: it means every extraction is guarded regardless of which
service produced it, including a future third-party or on-device one.

---

## 9. What needs real credentials vs. what is mocked

| Capability | MVP posture |
|---|---|
| Workout engine, editor, library, history | **Real.** No external dependency at all. |
| URL parsing + attribution | **Real.** Pure string work. |
| Media download from TikTok/IG | **Assumed unavailable** (U1). Graceful fallback to upload is the product behavior. |
| oEmbed / platform metadata | **Deferred.** Needs network + per-platform review. |
| Frame sampling from an uploaded video | **Real.** `VideoFrameMediaProcessor`, on-device. |
| Multimodal extraction | **Real.** Needs `ANTHROPIC_API_KEY` on the server only. |
| Transcription (ASR) | **Real.** Deepgram; needs `DEEPGRAM_API_KEY` on the server only. Optional — imports degrade to frames without it. |
| Auth (Apple/Google/email) | **Deferred to M6.** Local-first until then (PRD §26 — try first, account later). |
| Analytics sink | **Console adapter now**, port defined, real sink later. |
| Entitlements | **Port defined, always-allow adapter.** No paywall (PRD §34). |

The MVP is fully usable end-to-end with **zero credentials configured**.

---

## 10. Local-first persistence

Repository ports (`WorkoutRepository`, `SessionRepository`, `SourceRepository`) with an
AsyncStorage adapter today and an in-memory adapter for tests. Supabase slots in behind
the same ports when sync is needed. This is what makes PRD §26 ("try first, account later")
an architectural property rather than a feature request — there is no user id threaded
through business logic waiting to be filled in.

## 11. Cross-cutting boundaries

* **Analytics** is a port (`Tracker`) with the PRD §29 event taxonomy as a typed union.
  Events fire from `state/` (intent layer), never from `ui/` (render layer).
* **Entitlements** are checked exactly once, at the import boundary. Nothing else in the
  codebase imports the entitlement module.
* **Safety (PRD §32):** the extraction guardrail refuses to synthesize cues, modifications,
  or medical guidance. The app presents creator content as creator content and AI
  identification as AI identification — the review UI visually distinguishes the two.
