import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  test: {
    include: ['tests/**/*.test.ts'],
    passWithNoTests: true,
    environment: 'node',
    env: { MIMIC_LOG: '0' },
    testTimeout: 15_000,
  },
});
