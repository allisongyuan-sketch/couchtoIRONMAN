# Milestones

Tracked against PRD §40. Each milestone ends with: tests, type-check, lint, a manual
pass over the critical flow, and unresolved issues written down.

Status at time of writing:

| Milestone | Scope | Status |
|---|---|---|
| 1 | Core workout engine | **Done** |
| 2 | Library, editing, history | **Done** |
| 3 | Mock import | **Done** |
| 4 | AI extraction | **Seam built, vendor unwired** |
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

## Milestone 4 — AI extraction 🚧

**Built:** the abstraction, the guardrail pass, schema validation, the pipeline, and a
complete `LLMExtractionService` with tests that drive it through a fake `fetch`.

**Not built:** the media-processing stage that produces a transcript. This is blocked
on Milestone 5, not on model access — there is no point calling a model until there is
something to give it.

To switch on: set a real service in `src/state/container.ts`. Nothing else changes.

**Needs credentials:** ASR, multimodal extraction. See ARCHITECTURE.md §9.

## Milestone 5 — Sharing / ingestion 🚧

**Built:** the provider registry, URL parsing and attribution for TikTok, Instagram and
YouTube, the upload provider, and deep-link import (`repurpose://import?url=…&autostart=1`)
which the share sheet will hand off to.

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
npm test         # 75 tests, all pure — no simulator needed
npm run typecheck
npm run lint
npx expo export --platform web   # proves every route bundles
```
