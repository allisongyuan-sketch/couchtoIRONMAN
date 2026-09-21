/**
 * Bundle the API routes into plain JavaScript Vercel functions.
 *
 * Sources live in `server-routes/` and the output lands in `api/`, which is where
 * Vercel looks for functions and which is gitignored as build output.
 *
 * Why bundle rather than hand Vercel the TypeScript: the handler chain imports
 * through the `@/` path alias, and whether a given builder honours tsconfig paths is
 * exactly the kind of thing that works locally and fails in a deploy log at the worst
 * moment. esbuild resolves them here, so the platform only ever sees plain JS with
 * relative imports and nothing to resolve.
 *
 * Runs as the Vercel build command, so a git push redeploys with no upload step.
 */
import { build } from 'esbuild';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outDir = root;

mkdirSync(path.join(outDir, 'api'), { recursive: true });

const result = await build({
  entryPoints: [
    path.join(root, 'server-routes/extract.ts'),
    path.join(root, 'server-routes/transcribe.ts'),
  ],
  outdir: path.join(outDir, 'api'),
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'esm',
  // .mjs rather than .js: the output sits in a package with no "type" field, and an
  // ambiguous .js there is reparsed as ESM with a warning at best and misread as
  // CommonJS at worst. The extension removes the guesswork.
  outExtension: { '.js': '.mjs' },
  // The Anthropic SDK is by far the largest dependency and is declared in the
  // output's package.json instead, so the platform installs it. Keeps the uploaded
  // artifact small and lets the install layer be cached between deploys.
  // Installed by the platform rather than inlined, so the pinned versions the app is
  // tested against are the ones that run — and so the artifact stays small enough to
  // upload directly when a git-linked build is not available.
  external: ['@anthropic-ai/sdk', 'zod'],
  sourcemap: false,
  // Deployed artifacts, not something anyone reads. Minifying keeps the upload
  // small enough to inline in a single API call.
  minify: true,
  // Resolve the `@/…` alias the same way tsconfig does.
  alias: { '@': path.join(root, 'src') },
  logLevel: 'info',
  metafile: true,
});

// A package.json marking the output as ESM, and nothing else: the bundles carry
// their own dependencies, so there is nothing for the platform to install.

for (const [file, meta] of Object.entries(result.metafile.outputs)) {
  console.log(`  ${path.relative(root, file)} — ${(meta.bytes / 1024).toFixed(0)} KB`);
}
