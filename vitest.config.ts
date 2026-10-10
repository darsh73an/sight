import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    // dashboard/ and sdk/ are separate packages with their own tooling -
    // explicitly excluded so running `npm test` at the root never tries
    // to pull their files into this run.
    exclude: ['node_modules', 'dist', 'dashboard', 'sdk'],
  },
});
