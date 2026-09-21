# Deploying the extraction server

The app ships two server functions. They are the only code that holds a credential,
and they are never bundled into the app:

| Route            | Source                          | Needs                |
| ---------------- | ------------------------------- | -------------------- |
| `/api/extract`   | `src/server/extractHandler.ts`  | `ANTHROPIC_API_KEY`  |
| `/api/transcribe`| `src/server/transcribeHandler.ts`| `DEEPGRAM_API_KEY`  |

Both are plain web handlers — `(request: Request) => Promise<Response>` — so they run
on any platform that speaks that signature. Vercel is what the live deployment uses.

## Build

```bash
npm run build:api
```

`scripts/build-api.mjs` bundles `server-routes/*.ts` into `api/*.mjs` with esbuild,
resolving the `@/` alias ahead of time so the deploy platform only ever sees plain
JavaScript. `@anthropic-ai/sdk` and `zod` stay external and are installed from the
deployed `package.json`; everything else is inlined. Output is gitignored.

## Live deployment

Production: **https://repurpose-api.vercel.app**

```
GET  /api/extract     -> {"ok":true,"route":"extract","extractionConfigured":<bool>}
GET  /api/transcribe  -> {"ok":true,"route":"transcribe","transcriptionConfigured":<bool>}
```

The GET probes report whether the corresponding key is set without revealing it.
`extractionConfigured: false` means `POST /api/extract` will answer 503 — the route
is up, the credential is not there.

## Setting the keys

In the Vercel dashboard, project `repurpose-api` → Settings → Environment Variables:

- `ANTHROPIC_API_KEY` — required for extraction
- `DEEPGRAM_API_KEY` — optional; without it transcription answers 503 and the app
  falls back to frames, on-screen text and caption alone
- `EXTRACTION_MODEL` — optional override; defaults to `claude-opus-5`

Add them as **sensitive**, then redeploy so the functions pick them up.

Never give either key an `EXPO_PUBLIC_` prefix. That prefix is what tells Expo to
inline a value into the app bundle, where anyone with the binary can read it.

## Pointing the app at it

```bash
EXPO_PUBLIC_EXTRACTION_ENDPOINT=https://repurpose-api.vercel.app/api/extract
```

That is a URL, not a credential, so it is safe in the bundle. `/api/transcribe` is
derived from it automatically; set `EXPO_PUBLIC_TRANSCRIPTION_ENDPOINT` only if
transcription lives elsewhere. Leave the endpoint unset and the app runs on mock
extraction with no other change.

## Redeploying

The Vercel project is not yet linked to the GitHub repository, so the current
deployment was uploaded as files rather than built from a commit. Installing the
Vercel GitHub App on `allisongyuan-sketch/couchtoIRONMAN` and connecting it to the
`repurpose-api` project makes every push deploy the bundle straight from source,
which is how this should work going forward.
