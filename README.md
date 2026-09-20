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

Expo Go runs everything except the share sheet, which is native code and needs a
development build (`npx expo prebuild` and a real build). Paste-a-link and upload both
work in Expo Go.

No credentials, API keys or backend are required. Extraction runs on a mock service
that returns schema-valid fixtures, so the entire flow — import, review, edit, save,
train, complete — works out of the box.

Try it with any TikTok, Instagram or YouTube link, for example:

```
https://www.tiktok.com/@coachlena/video/7311122334455
```

### Turning on real AI extraction

Two variables, and only one of them is a secret.

```bash
# On the server. NEVER prefix these with EXPO_PUBLIC_ — that would inline them into
# the app bundle, where anyone with the binary can read them.
ANTHROPIC_API_KEY=sk-ant-...
DEEPGRAM_API_KEY=...          # optional — enables speech transcription

# In the app. A URL, not a credential.
EXPO_PUBLIC_EXTRACTION_ENDPOINT=https://your-deployment.example.com/api/extract
```

With the endpoint set, the app transcribes the video and samples frames from it, then
sends the combined evidence to Claude through an endpoint you control. Unset it and
the app returns to mock extraction with no other change — that switch is one ternary
in `src/state/container.ts`.

See `.env.example` for the full annotated list.

**All three extraction sources now work.** Speech is transcribed (Deepgram, which takes
an MP4 directly and returns per-word confidence). On-screen text is read straight off
the sampled frames. And the frames identify the movement itself when the creator never
names it. That is the PRD's full source priority — speech, on-screen text, caption,
then visual identification — with each one carrying its own provenance.

**Transcription is optional and best-effort.** Leave `DEEPGRAM_API_KEY` unset, or have
it fail, or hand it a silent video, and the import runs on frames alone rather than
failing. A workout with movements and no numbers is a usable result; an error screen
is not.

**Where video comes from.** Platforms generally won't let anyone download a Reel or a
TikTok, so a link we can't fetch lands on "We couldn't access enough of this video"
with an upload fallback. Two paths get us real media anyway: the user uploads it, or —
better — the share sheet hands over the video file itself, which is media we could
never have fetched on our own. When a share carries both a file and a link, the file
wins and the link is kept for attribution.

## Verifying it

```bash
npm test           # 171 tests — no simulator, no credentials, no network
npm run typecheck
npm run lint
npx expo export --platform web    # proves every route and both API routes bundle
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
  ingestion/    pluggable providers + share-payload resolution (never assumes
                media is downloadable)
  extraction/   AI abstraction, guardrails, wire contract, frame sampling, fixtures
  transcription/ ASR port, uncertain-quantity detection, device-side client
  editing/      pure workout mutations that preserve creator values
src/server/   Server-only. The Claude call, the Deepgram call, and their endpoint
              handlers — never bundled into the app, because the keys live here.
src/data/     Repository ports over a swappable key-value store
src/state/    Zustand stores binding core to UI
src/ui/       Design system
supabase/     Postgres schema (not needed to run the MVP)
```

Three things that are worth knowing before reading the code:

**Provenance is enforced, not requested.** Every extracted value records where it came
from. A guardrail pass mechanically strips any prescription the source never supported —
you can *see* that someone is doing a Romanian deadlift, but you cannot see that they
prescribed three sets of ten. That rule is a function, not a line in a prompt, and
there is a test that drives a deliberately misbehaving model through it.

**No credential ever reaches the device.** An API key in a mobile bundle is extractable
from the shipped binary, so the model is called from a server (`app/api/extract+api.ts`)
and the app only knows a URL.

**Missing information is never filled in.** There is no code path that writes a
plausible default. Unstated values render as "Not specified"; uncertain ones as
"Unclear ⚠️" — and that second case is now driven by real signal: when the transcriber
is unsure whether it heard "twelve" or "twenty", that specific number is flagged and
handed to the model, which marks it unclear rather than picking one.

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

Milestones 1–4 are complete, and extraction now reads all of its intended sources:
speech, on-screen text, caption, and visual identification. Evidence is gathered on
device, sent through endpoints that hold the keys, and the structured output is
validated and guarded before it reaches the app.

It has been verified against stubbed vendor clients and the built server bundle, but
**not yet against either live API** — no credentials existed in the environment it was
built in. That is the first thing to do with real keys.

Milestone 5 is complete: share sheet, deep link and upload all route into the same
import flow. The share extension's native config was verified by introspection rather
than on a device, which needs a real build. Milestone 6 is complete apart from
authentication, which is last on purpose — a user should reach their first converted
workout before anyone asks them to register.

Details, including what is blocked on what, are in [MILESTONES.md](docs/MILESTONES.md).
