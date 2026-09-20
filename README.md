# Repurpose

**See a workout you want to try? Share it to Repurpose and turn it into a workout you
can actually do.**

Short-form video is optimized for *watching* workouts, not *doing* them. Repurpose
converts a TikTok, Reel or Short into a structured, executable workout with a guided
player — timers, sets, rest, circuits — so nobody has to scrub back through a video
between exercises.

The original creator remains the source of the workout. Repurpose is the execution
layer.

```
WATCHABLE CONTENT  →  STRUCTURED WORKOUT  →  INTERACTIVE EXECUTION
```

## Running it

```bash
npm install
npm start          # then open in Expo Go, or press w for web
```

No credentials, API keys or backend are required. Extraction runs on a mock service
that returns schema-valid fixtures, so the entire flow — import, review, edit, save,
train, complete — works out of the box.

Try it with any TikTok, Instagram or YouTube link, for example:

```
https://www.tiktok.com/@coachlena/video/7311122334455
```

## Verifying it

```bash
npm test           # 75 tests, pure TypeScript, no simulator needed
npm run typecheck
npm run lint
npx expo export --platform web    # proves every route bundles
```

The required acceptance scenario from the PRD (§41) is a test, not a checklist:
`src/core/acceptance.test.ts`.

## How it is put together

The governing rule: **the core is pure TypeScript with zero React Native imports.**

```
app/          Expo Router screens. Thin — they compose, they do not decide.
src/core/     Pure domain. No RN, no network. Where the product's rules live.
  schema/       provenance + block-structured workouts + execution plan
  engine/       plan compiler and the session state machine
  ingestion/    pluggable content providers (never assumes media is downloadable)
  extraction/   AI abstraction, guardrails, fixtures, vendor implementation
  editing/      pure workout mutations that preserve creator values
src/data/     Repository ports over a swappable key-value store
src/state/    Zustand stores binding core to UI
src/ui/       Design system
supabase/     Postgres schema (not needed to run the MVP)
```

Three things that are worth knowing before reading the code:

**Provenance is enforced, not requested.** Every extracted value records where it came
from. A guardrail pass mechanically strips any prescription the source never supported —
you can *see* that someone is doing a Romanian deadlift, but you cannot see that they
prescribed three sets of ten. That rule is a function, not a line in a prompt.

**Missing information is never filled in.** There is no code path that writes a
plausible default. Unstated values render as "Not specified"; uncertain ones as
"Unclear ⚠️".

**Social media may not be downloadable, and the app assumes it isn't.** Ingestion
returns a capability report rather than a file, and degrading to attribution-only is a
first-class outcome with an upload and manual-entry path — not an error state bolted on.

## Documentation

| Document | What it covers |
|---|---|
| [ARCHITECTURE.md](docs/ARCHITECTURE.md) | The shape of the system, and the risks it absorbs |
| [SCHEMA.md](docs/SCHEMA.md) | The structured workout and extraction schema |
| [DECISIONS.md](docs/DECISIONS.md) | The non-obvious calls, and what they cost |
| [MILESTONES.md](docs/MILESTONES.md) | Status against the PRD's milestones |

## Status

Milestones 1–3 are complete and verified. Milestone 4's AI seam is built and tested
against a fake vendor but deliberately unwired; Milestone 5's app-side flow is done and
the native share extension is pending a development build. Milestone 6 is complete
apart from authentication, which is last on purpose — a user should reach their first
converted workout before anyone asks them to register.

Details, including what is blocked on what, are in [MILESTONES.md](docs/MILESTONES.md).
