import { defineConfig } from 'vitest/config';
import path from 'node:path';

/**
 * The core is pure TypeScript with no React Native imports, so it runs in plain Node.
 * That is the point: the expensive logic (provenance, execution semantics, timers,
 * guardrails) is verifiable without a simulator.
 */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
  resolve: {
    alias: { '@': path.resolve(__dirname, 'src') },
  },
});
