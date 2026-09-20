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
| 5 | Sharing / ingestion | **Done** |
| 6 | Hardening | **Done** |

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

## Milestone 5 — Sharing / ingestion ✅

**Built:** the provider registry, URL parsing and attribution for TikTok, Instagram and
YouTube, deep-link import (`repurpose://import?url=…&autostart=1`) which the share
sheet will hand off to, and — new — a working **video upload path** via
`expo-image-picker`, surfaced both on the import screen and on the "we couldn't access
this video" failure screen. With real extraction configured, upload is the route that
actually works today.

**Share sheet.** `expo-share-intent` supplies the iOS Share Extension target and the
Android `ACTION_SEND` intent filters; `useShareHandoff` drops whatever arrives
straight into the import flow, so the user lands on the processing screen with work
already underway. Tapping Analyze after sharing would defeat the point.

All the interpretation is pure and tested (`src/core/ingestion/shareIntent.ts`),
because what arrives is messy and platform-specific:

* iOS usually sends a clean `webUrl`.
* Android usually sends free text — `Check this out https://vm.tiktok.com/ZGabc/ 🔥` —
  so the URL has to be dug out, and the *supported* one picked when the text carries
  several (a tracking link, a profile link, and the video).
* Either may send the **video file itself**, which is the best case of all.

**A shared file beats a shared link, and that partly answers U1.** When the share
sheet hands over the video, we have media we could never have downloaded ourselves —
so it wins over any URL in the same payload, and the import runs the full
transcription + frame pipeline. The link is kept for attribution.

**Requires a development build.** The share extension is native code, so Expo Go
cannot host it. The package uses `requireOptionalNativeModule`, so Expo Go still runs
the app normally — paste-a-link and upload both work — it just receives no shares.

**Not verified on a device.** The config plugin was verified by introspecting the
generated native config (iOS extension target, App Group, Android intent filters), the
resolver is tested against real payload shapes, and the bundle builds. But no actual
share has been performed — that needs `npx expo prebuild` and a real build.

## Milestone 6 — Hardening ✅

**Done:** confidence states, missing-data handling, all §31 error states, retry without
starting over, local persistence, the analytics event taxonomy with a swappable sink,
and an entitlement check at the import boundary.

**Accounts and sync.** Added last on purpose, and the local-first data model meant it
restructured nothing — sync is a new *caller* of the existing `WorkoutRepository` and
`SessionRepository` ports, not a rewrite of them. Email sign-in uses a one-time link
(no password to choose, forget or leak); Apple and Google slot into
`nativeProviders` in the composition root.

**The decision that matters is what happens to local data on sign-in: union by id,
never delete, never overwrite silently.** Ids are generated on device and globally
unique, so a union is lossless — nobody signs in and watches their workouts
disappear, which is the failure that would destroy trust in a local-first app
instantly. When the same id exists on both sides, the newer `updatedAt` wins; a tie
writes nothing at all, so re-running sync over unchanged data costs no round trips.

Deletion is deliberately **not** synced. A record missing from one side means "not
seen here yet", not "deleted", and telling those apart needs tombstones. Guessing
wrong deletes a user's data, so until tombstones exist a delete stays local.

Sync stores the workout **document**, not the relational tables from `0001_init.sql`.
Those model workouts relationally for server-side querying nobody does yet; shredding
a nested document into five tables and reassembling it is a lot of code with a lot of
places to quietly drop provenance. The document stays the source of truth, which is
what makes adding that projection safe later. See `supabase/migrations/0002_sync.sql`.

**Optional throughout.** With no Supabase project configured the app is exactly what
it was before accounts existed, and the Profile screen says so rather than implying a
backup that does not exist.

**Not verified against a live Supabase project** — no credentials in this
environment. The auth service and both document stores are tested against stubbed
clients, and the merge and sync logic are tested end to end against in-memory
repositories, including the round trip that preserves provenance.

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
