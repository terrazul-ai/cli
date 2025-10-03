/* eslint import/no-default-export: off */
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts', 'tests/**/*.test.tsx'],
    environment: 'node',
    reporters: 'default',
    testTimeout: 30_000,
    hookTimeout: 30_000,
    poolOptions: {
      threads: {
        singleThread: true,
      },
    },
  },
});
