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

**Evidence it matters:** `anthropicExtractor.test.ts` drives a deliberately misbehaving
model through the real pipeline — one that claims it counted 3 sets of 10, a 60-second
rest and 4 rounds, all sourced from watching, plus a coaching cue it wrote itself. Every
invented number is stripped and the cue is removed; only the movement name survives.

**Where they run:** on the client, inside `runExtractionPipeline` — not on the server.
That way every extraction is guarded regardless of which service produced it, including
a future third-party or on-device one.

**The subtle distinction the prompt has to teach:** text burned into a frame is
something the creator *wrote*, so a prescription read from it is real evidence
(`onscreen_text`). Counting repetitions by watching a body is not (`visual_identification`).
Both arrive through the same pixels, and only one of them may set a number.

---

### 3b. Extraction runs on a server, and that is not negotiable

**Why.** An `ANTHROPIC_API_KEY` in a React Native bundle can be pulled out of the
shipped binary. `EXPO_PUBLIC_` variables are inlined at build time by design, so there
is no safe way to put a credential in app config, and no obfuscation that changes this.
A leaked key is someone else's bill and our rate limit.

So the device posts evidence to `/api/extract`, and that endpoint holds the key. The
client-side service knows a URL and nothing else — no prompt, no model name, no
credential. A test asserts the outgoing request carries no `authorization` or
`x-api-key` header, so if anyone moves the model call back onto the client, it fails.

**Cost.** The app needs a deployed backend to do real extraction, which the mock path
deliberately does not. That is the right trade: shipping a key would be worse.

---

### 3c. The model gets its own wire schema, not the domain schema

**Why.** Three reasons, in increasing order of importance. Structured outputs need a
closed schema — every field required, `additionalProperties: false`, no defaults — and
the domain schema is none of those. "Not specified" is much harder for a model to get
wrong as `value: null` on a field that is always present than as an omitted key. And
the domain schema should be free to change without renegotiating with a model.

The interesting part is what the wire schema *withholds*. `needsReview` is not in it —
review status is derived from confidence in one place, so the threshold cannot drift
per response. Neither is `source: 'user'` — if the model could claim it, a fabricated
value would render to the user as their own correction. A test asserts the string
`"user"` never appears in the generated JSON schema.

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

### 7b. Frames and speech are separate evidence paths, and either alone is enough

**Why.** Claude has no audio input, so these are genuinely two integrations, not one.
Frames were built first because they were shippable alone: sampled stills give both
the movement being demonstrated and any prescription burned into the video, and
short-form fitness content puts its numbers on screen constantly.

Speech closes the other half. A creator who only *says* "three rounds of ten" is now
captured, and the two paths overlap rather than depend on each other — neither creator
has to do both. The extraction request carries whatever was gathered, and
`hasAnalyzableEvidence` accepts a transcript with no frames just as readily as frames
with no transcript.

**Cost.** A second vendor, a second key, and a second endpoint.

---

### 7c. Transcription is allowed to fail quietly

**Why.** It is evidence-gathering, not reasoning. If the transcriber is down, the
right outcome is a workout built from frames — not an error screen. PRD §8 is explicit
that missing information must never prevent creation of a workout, and a missing
*source* is just a broader case of that.

So `VideoFrameMediaProcessor` catches everything from the transcription client and
falls back to `null`. Three paths are tested independently: provider not configured,
provider errors, and video is silent. The last one is not even a degradation — a
wordless demonstration is a perfectly normal video.

**Consequence.** Transcription failures are invisible to the user, which is correct
here but would not be for extraction itself. The asymmetry is deliberate: losing one
of four evidence sources changes the result's completeness, while losing the model
means there is no result at all.

---

### 7d. Uncertain numbers are carried separately from the transcript

**Why.** This is the mechanism behind PRD §9, which uses the exact example of "12 reps"
versus "20 reps". For the app to show "Unclear ⚠️" rather than silently committing to
one reading, the uncertainty has to survive the trip from the transcriber to the
extraction model.

A sentence-level confidence score does not survive it. "Rest for sixty seconds between
rounds" with one shaky word averages out to ~0.9 — the one number that matters
disappears into the mean. So `findUncertainQuantities` pulls out the individual number
tokens below threshold, with surrounding context, and those are handed to the model as
their own field. There is a test built on exactly that sentence.

Two smaller calls inside it: numbers are held to a **stricter** threshold (0.85) than
prose, because mishearing "Bulgarian" is cosmetic while mishearing "fifteen" changes
what the user does; and a shaky *non*-number is deliberately ignored.

---

### 7e. A shared file beats a shared link

**Why.** U1 — that platforms will not let us download a Reel or a TikTok — is the
product's biggest risk, and the share sheet partly routes around it. When a user
shares from their own gallery, or from an app that attaches the media, the payload
carries the **video file**. That is media we could never have fetched ourselves, and
it feeds the full pipeline: transcription, frames, the lot.

So when a share carries both a file and a URL, the file wins and the URL is kept for
attribution. A link is a request to go and get something we probably cannot get; a
file is the thing itself.

**The messy part is everything else.** iOS usually sends a clean `webUrl`; Android
usually sends a sentence with the link inside it, and often several links at once — a
tracking redirect, the creator's profile, and the video. `resolveSharedContent` picks
the *supported* one rather than the first one, and all of it is pure, so each real
payload shape is a test instead of something to discover on a device.

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
