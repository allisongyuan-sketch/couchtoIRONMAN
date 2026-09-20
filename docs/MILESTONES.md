# Milestones

Tracked against PRD §40. Each milestone ends with: tests, type-check, lint, a manual
pass over the critical flow, and unresolved issues written down.

Status at time of writing:

| Milestone | Scope | Status |
|---|---|---|
| 1 | Core workout engine | **Done** |
| 2 | Library, editing, history | **Done** |
| 3 | Mock import | **Done** |
| 4 | AI extraction | **Done** (speech is the remaining gap) |
| 5 | Sharing / ingestion | **Deep link done, native share pending** |
| 6 | Hardening | **Partly done** |

---

## Milestone 1 — Core workout engine ✅

A manually populated structured workout executes end to end: exercises, sets, reps,
timers, rest, circuits, progression, completion.

* `compilePlan` flattens blocks into an ordered step list (`src/core/engine/plan.ts`)
* `sessionReducer` is a pure state machine (`src/core/engine/session.ts`)
* Timers are deadline-based, so backgrounding cannot desynchronize them
* The PRD §41 acceptance scenario runs as a test (`src/core/acceptance.test.ts`)

**Proved independently of AI**, which was the point of doing it first.

## Milestone 2 — Library ✅

Save, edit, library, history.

* Repository ports with an AsyncStorage adapter and an in-memory adapter for tests
* Pure editing operations that preserve superseded creator values
* Library with search; History grouped by day
* Active sessions persist on every event and are restored on launch

## Milestone 3 — Mock import ✅

Import → Review → Edit → Save → Execute, driven by representative structured JSON.

* Four fixtures, each encoding a specific PRD requirement: the §41 circuit, a
  no-prescription mobility flow (§8), an ambiguous-reps case (§9), and straight sets
* Deterministic selection from the URL, so a given link always produces the same
  workout
* All four §31 failure states are reachable and tested

## Milestone 4 — AI extraction ✅

Real extraction against Claude, end to end.

* `src/server/anthropicExtractor.ts` — the only file that knows a model exists. Uses
  the Anthropic SDK with structured outputs (`messages.parse` + `zodOutputFormat`),
  adaptive thinking, and a cached system prompt.
* `src/server/extractHandler.ts` + `app/api/extract+api.ts` — the endpoint, so the API
  key lives on a server and never in the app bundle.
* `src/core/extraction/remoteExtractionService.ts` — the client side. No prompt, no
  model name, no credential.
* `src/core/extraction/videoFrameProcessor.ts` — samples and downscales frames from an
  uploaded video. This is the real media-processing stage.

**How it works without speech recognition.** Claude reads the sampled frames, which
yields two different things with two different provenances: the movement being
demonstrated (`visual_identification`) and any prescription the creator burned into
the video (`onscreen_text`). Short-form fitness content puts "3 × 10" on screen
constantly, so this path alone recovers a great deal — and because on-screen text is
something the creator *wrote*, those prescriptions pass the guardrails legitimately.

**The remaining gap: spoken prescriptions.** Claude has no audio input, so a creator
who only *says* "three rounds of ten" is not yet captured. That needs an ASR provider
(Whisper, Deepgram, or similar) feeding `ProcessedMedia.transcript` — the field, the
prompt handling and the provenance rules for it already exist and are tested. It is an
additional integration, not a redesign.

**To switch on:** set `ANTHROPIC_API_KEY` where the server runs, and point
`EXPO_PUBLIC_EXTRACTION_ENDPOINT` at the deployed endpoint. Unset the latter and the
app returns to mock extraction with no other change. See `.env.example`.

**Verified without a live API call.** No credentials existed in the environment this
was built in, so the extractor is tested against a stubbed SDK client: request shape,
every response branch, SDK error → retryability mapping, and — the one that matters —
that a model ignoring the prompt still cannot get an invented prescription past the
guardrails. The endpoint itself was smoke-tested against the real built server bundle.
**It has not yet been run against the live API**; that is the first thing to do with a
real key.

## Milestone 5 — Sharing / ingestion 🚧

**Built:** the provider registry, URL parsing and attribution for TikTok, Instagram and
YouTube, deep-link import (`repurpose://import?url=…&autostart=1`) which the share
sheet will hand off to, and — new — a working **video upload path** via
`expo-image-picker`, surfaced both on the import screen and on the "we couldn't access
this video" failure screen. With real extraction configured, upload is the route that
actually works today.

**Not built:** the native share extension. This needs an iOS Share Extension target and
an Android `ACTION_SEND` intent filter, which means a config plugin and a development
build — Expo Go cannot host it. The app-side flow is already in place, so this is
native plumbing rather than product work.

**Open question (U1):** whether media can be obtained at all, per platform. The
architecture assumes it cannot and degrades to upload/manual. If an official API path
opens up for a platform, it is one provider change.

## Milestone 6 — Hardening 🚧

**Done:** confidence states, missing-data handling, all §31 error states, retry without
starting over, local persistence, the analytics event taxonomy with a swappable sink,
and an entitlement check at the import boundary.

**Remaining:** authentication (Apple/Google/email) and sync. Deliberately last, per
PRD §26 — the user should reach their first converted workout before being asked to
register, and the local-first data model means adding auth does not restructure
anything.

---

## Verification

```bash
npm test         # 113 tests — no simulator, no credentials, no network
npm run typecheck
npm run lint
npx expo export --platform web   # proves every route and the API route bundle
```

To smoke-test the endpoint against the real built server:

```bash
npx expo export --platform web --output-dir dist
npx expo serve --port 8099
curl -X POST http://localhost:8099/api/extract -H 'content-type: application/json' \
  -d '{"sourceContentId":"s1","source":{"platform":"upload"},"mediaAnalyzed":true,"frames":[]}'
```
