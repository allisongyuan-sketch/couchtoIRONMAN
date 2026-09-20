# Milestones

Tracked against PRD §40. Each milestone ends with: tests, type-check, lint, a manual
pass over the critical flow, and unresolved issues written down.

Status at time of writing:

| Milestone | Scope | Status |
|---|---|---|
| 1 | Core workout engine | **Done** |
| 2 | Library, editing, history | **Done** |
| 3 | Mock import | **Done** |
| 4 | AI extraction | **Done** — speech, on-screen text and vision |
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

* `src/server/transcription/deepgram.ts` — speech transcription, with the endpoint
  and device-side client alongside the extraction pair.
* `src/core/transcription/uncertainQuantities.ts` — pulls out the individual numbers
  the transcriber doubted.

**All three source types now work**, which is the PRD §10 priority order in full:

| Source | How | Provenance |
|---|---|---|
| Spoken audio | Deepgram, which takes the MP4 directly | `speech` |
| On-screen text | Claude reads it off the sampled frames | `onscreen_text` |
| Caption | Passed through from ingestion | `caption` |
| The movement itself | Claude identifies it from the frames | `visual_identification` |

The frame path and the speech path complement each other rather than overlapping: a
creator who writes "3 × 10" on screen and a creator who says it out loud are both
captured, and neither has to do both.

**Why Deepgram.** Two properties decided it. It accepts an MP4 and demuxes the audio
itself, so the app needs no ffmpeg, no native audio module and no re-encode step. And
it returns **per-word confidence**, which is what PRD §9 actually requires — an overall
transcript score cannot tell you that one number in an otherwise clean sentence was a
coin flip. Swapping providers means one class and one line in
`src/server/transcription/index.ts`.

**Transcription is optional and best-effort.** No key configured, a provider outage, or
a silent video all degrade the import to frames-only rather than failing it. There are
tests for each of those three paths.

**To switch on:** set `ANTHROPIC_API_KEY` (and optionally `DEEPGRAM_API_KEY`) where the
server runs, and point `EXPO_PUBLIC_EXTRACTION_ENDPOINT` at the deployed endpoint.
Unset the latter and the app returns to mock extraction with no other change. See
`.env.example`.

**Verified without a live API call.** No credentials existed in the environment this
was built in, so both vendors are tested against stubbed clients: request shape, every
response branch, error → retryability mapping, and — the one that matters — that a
model ignoring the prompt still cannot get an invented prescription past the
guardrails. Deepgram's parser is tested against a recorded-shape payload. Both
endpoints were smoke-tested against the real built server bundle.

**Neither has yet been run against its live API**; that is the first thing to do with
real keys. The specific things to confirm there are the Deepgram response shape under
`utterances=true` (the parser falls back to the channel alternative if it differs) and
end-to-end extraction quality on real short-form video.

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
npm test         # 158 tests — no simulator, no credentials, no network
npm run typecheck
npm run lint
npx expo export --platform web   # proves every route and both API routes bundle
```

To smoke-test the endpoint against the real built server:

```bash
npx expo export --platform web --output-dir dist
npx expo serve --port 8099
curl -X POST http://localhost:8099/api/extract -H 'content-type: application/json' \
  -d '{"sourceContentId":"s1","source":{"platform":"upload"},"mediaAnalyzed":true,"frames":[]}'
```
