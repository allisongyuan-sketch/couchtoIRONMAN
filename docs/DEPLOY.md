# Deploying the extraction server

The app ships two server functions. They are the only code that holds a credential,
and they are never bundled into the app:

| Route             | Source                            | Needs               |
| ----------------- | --------------------------------- | ------------------- |
| `/api/extract`    | `src/server/extractHandler.ts`    | `ANTHROPIC_API_KEY` |
| `/api/transcribe` | `src/server/transcribeHandler.ts` | `DEEPGRAM_API_KEY`  |

Both are plain web handlers — `(request: Request) => Promise<Response>` — so they run
on any platform that speaks that signature. Vercel is what the live deployment uses.

## Layout

```
server-routes/*.ts   the route bindings (two lines each)
scripts/build-api.mjs  esbuild: server-routes/ -> server/api/
server/              the deploy unit, committed
  api/*.mjs          bundled functions
  package.json       two dependencies, generated
  vercel.json        per-function limits
```

`server/` is the Vercel project's **Root Directory**. Everything the deploy needs is
inside it and nothing else is installed — two dependencies rather than the app's
entire React Native tree — and there is no build step on deploy.

## Why the bundles are committed

Generated files in git deserve a reason. This one was measured, not assumed.

Vercel decides which functions a deployment has by reading the files in the
*checkout*, before the build command runs. A build command that writes `api/*.mjs`
produces a deployment that **goes green with no functions at all** and 404s every
route. That was confirmed against a real preview deployment: the build logged
`wrote api/hello.mjs`, the deployment reached READY, the file tree contained no
lambda, and `GET /api/hello` returned 404. Nothing reported a problem.

So the checkout has to already contain what Vercel looks for. `npm run build:api`
regenerates `server/`, and CI reruns it and fails if the result differs from what the
branch carries — which is the only thing standing between committed build output and
silent drift.

## Build

```bash
npm run build:api
```

esbuild resolves the `@/` path alias ahead of time, so the platform only ever sees
plain JavaScript with relative imports. `@anthropic-ai/sdk` and `zod` stay external
and are declared in the generated `server/package.json`, at the versions the app's
own `package.json` pins — so the versions the tests run against are the versions that
run in production.

## Live deployment

Production: **https://repurpose-api.vercel.app**

```
GET  /api/extract     -> {"ok":true,"route":"extract","extractionConfigured":<bool>}
GET  /api/transcribe  -> {"ok":true,"route":"transcribe","transcriptionConfigured":<bool>}
```

The GET probes report whether the corresponding key is set without revealing it.
`extractionConfigured: false` means `POST /api/extract` answers 503 — the route is
up, the credential is not there.

## Setting the keys

Vercel dashboard, project `repurpose-api` → Settings → Environment Variables:

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

## Connecting git

The project is configured (Root Directory `server`, no build command, Vercel
Authentication off) but not yet linked to the repository, because the Vercel GitHub
App is not installed on it. Installing it at https://github.com/apps/vercel and
granting access to `allisongyuan-sketch/couchtoIRONMAN`, then connecting the repo
under the project's Settings → Git, makes every push to `main` deploy.

Until then, deployments are created by uploading the contents of `server/` directly.
