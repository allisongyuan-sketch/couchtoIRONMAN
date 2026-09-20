# Decisions

The handful of choices that were not obvious, and what they cost.

---

### 1. The core is pure TypeScript with zero React Native imports

**Why.** The expensive things to get right — provenance, circuit semantics, timer
math, guardrails — are the things a UI rewrite would otherwise put at risk. Keeping
them in `src/core` means they are tested in Node in under two seconds, and the same
engine can later drive an Apple Watch app or a web player (PRD §36) without a rewrite.

**Cost.** Some ceremony: `Date.now()` is passed in rather than read, storage goes
through a port. Both have already paid for themselves — deterministic timer tests and
in-memory repository tests exist only because of it.

---

### 2. Workouts are a tree of blocks, not a flat exercise list

**Why.** "Do these three back-to-back for four rounds" is not three exercises that each
claim four sets. The PRD's acceptance test (§41) depends on this: a circuit rests
*after the round*, straight sets rest *after each set*. Modelling the circuit directly
means the AI only has to *label* the structure, not encode its execution semantics.

**Cost.** One more level of nesting in the schema and the editor. Worth it — the
alternative is special-case logic in the player, which is exactly what PRD §22 warns
against.

---

### 3. Guardrails are code, not prompt text

**Why.** "Do not invent a prescription" is a request when it is in a prompt and a rule
when it is in a function. `applyGuardrails` mechanically deletes any quantitative field
sourced from visual identification, and any AI-authored form cue, whatever the model
returned. The system prompt asks for the same behaviour — both exist because a prompt
degrades silently and a guardrail does not.

**Evidence it matters:** `llmService.test.ts` drives a deliberately misbehaving vendor
through the pipeline and asserts the invented sets, reps and cue are all stripped while
the movement name survives.

---

### 4. Rest steps are emitted only when the creator specified rest

**Why.** PRD §3.1 gives this exact example: do not insert 60 seconds because that is
typical. So `compilePlan` emits no rest step at all when no rest was stated, and the
hip mobility fixture compiles to four steps with zero rests.

**Consequence.** A workout can have no rest anywhere. That is correct — it reflects the
source. The user can add rest in the editor, and that value is then marked as theirs.

---

### 5. Timers store a deadline, not a countdown

**Why.** A tick-based timer drifts whenever the app is backgrounded, the phone locks,
or an interval is throttled — which is most of a real rest period. Storing `endsAt` and
deriving the remainder from the wall clock makes all of that irrelevant.

**Test that pins it:** the session suite advances the clock 45 seconds with no `TICK`
events at all and asserts the timer reads zero.

---

### 6. Ingestion returns a capability report, not a file

**Why.** The PRD is emphatic (§19): do not architect around the assumption that
arbitrary TikTok or Instagram media can be downloaded. So `IngestionResult` has a
`metadata_only` case that is explicitly **not an error** — we keep the creator, the
link and the thumbnail, show correct attribution, and route to upload or manual entry.

**Consequence.** The happy path in the MVP runs on mocks, gated by one flag
(`analyzeMetadataOnlyContent`). Flipping it to `false` produces the real-world
behaviour today, and that path is tested.

---

### 7. Extraction records are kept separately from workouts

**Why.** Two reasons, and the second is the one that matters. First, a user edit must
never destroy what the creator actually prescribed. Second, extraction edit rate
(PRD §29/§30) is only measurable if the original survives — it is the diff between the
extraction and the workout. Storing them in one mutable object would quietly delete the
metric that tells us where extraction is failing.

---

### 8. Mock services ship in the product build

**Why.** `MockExtractionService` returns schema-valid fixtures with realistic latency.
That is what let Milestones 1–3 be finished and *verified* before any credentials
existed, and it keeps the whole flow demoable offline. It validates its own fixtures
against the real schema, so a drifting fixture fails exactly like a bad vendor would.

---

### 9. Progress labels rotate on a timer, with no percentage bar

**Why.** The pipeline cannot honestly report progress, and PRD §5 says not to imply
precision the system does not have. Rotating honest descriptions with an indeterminate
spinner is the truthful version of a progress screen.

---

### 10. No authentication in the MVP

**Why.** PRD §26: the user should experience their first conversion before being asked
to register. Local-first repositories with no user id threaded through business logic
make this an architectural property rather than a feature flag — adding auth later
means syncing this data, not restructuring it.

**Cost.** Data lives on one device until Milestone 6. The Profile screen says so
plainly rather than implying a backup that does not exist.
