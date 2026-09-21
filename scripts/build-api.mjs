/**
 * Bundle the API routes into plain JavaScript Vercel functions.
 *
 * Sources live in `server-routes/` and the output lands in `server/api/`, which is
 * committed. That is deliberate and was measured, not assumed: Vercel decides which
 * functions a deployment has by looking at the files in the *checkout*, before the
 * build command runs. A build command that writes `api/*.mjs` produces a deployment
 * that goes green with no functions at all and 404s every route — the worst kind of
 * failure, because nothing reports it. Committing the bundles means the checkout
 * already contains what Vercel looks for, and no build step runs on deploy.
 *
 * `npm run build:api` regenerates them and CI fails if the result differs from what
 * is committed, so the bundles cannot silently drift from their sources.
 *
 * Why bundle rather than hand Vercel the TypeScript: the handler chain imports
 * through the `@/` path alias, and whether a given builder honours tsconfig paths is
 * exactly the kind of thing that works locally and fails in a deploy log at the worst
 * moment. esbuild resolves them here, so the platform only ever sees plain JS with
 * relative imports and nothing to resolve.
 */
import { build } from 'esbuild';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const serverDir = path.join(root, 'server');
const apiDir = path.join(serverDir, 'api');

// The two dependencies the bundles do not inline. Their versions are read from the
// app's own package.json rather than written twice, so the versions the tests run
// against are the versions that run in production.
const EXTERNAL = ['@anthropic-ai/sdk', 'zod'];

const appPkg = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));

mkdirSync(apiDir, { recursive: true });

const result = await build({
  entryPoints: [
    path.join(root, 'server-routes/extract.ts'),
    path.join(root, 'server-routes/transcribe.ts'),
  ],
  outdir: apiDir,
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'esm',
  // .mjs rather than .js: an ambiguous .js is reparsed as ESM with a warning at best
  // and misread as CommonJS at worst. The extension removes the guesswork.
  outExtension: { '.js': '.mjs' },
  // Declared in server/package.json instead of inlined, so the deploy installs them.
  // Keeps the committed artifact small enough to read in a diff.
  external: EXTERNAL,
  sourcemap: false,
  // Deployed artifacts, not something anyone reads.
  minify: true,
  // Resolve the `@/…` alias the same way tsconfig does.
  alias: { '@': path.join(root, 'src') },
  logLevel: 'info',
  metafile: true,
});

// The deploy unit's own manifest. Vercel's Root Directory points at `server/`, so
// this is the only package.json the deploy installs — two dependencies rather than
// the app's entire React Native tree.
const dependencies = Object.fromEntries(
  EXTERNAL.map((name) => {
    const version = appPkg.dependencies?.[name];
    if (!version) throw new Error(`${name} is not a dependency of the app`);
    return [name, version];
  }),
);

writeFileSync(
  path.join(serverDir, 'package.json'),
  `${JSON.stringify({ name: 'repurpose-api', private: true, type: 'module', dependencies }, null, 2)}\n`,
);

for (const [file, meta] of Object.entries(result.metafile.outputs)) {
  console.log(`  ${path.relative(root, file)} — ${(meta.bytes / 1024).toFixed(1)} KB`);
}
