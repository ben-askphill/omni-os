import { defineConfig } from 'vitest/config';

export default defineConfig({
  root: import.meta.dirname,
  // The app's tsconfig extends `expo/tsconfig.base`, which Vite's tsconfig loader cannot resolve.
  tsconfig: './tsconfig.vitest.json',
  test: {
    include: ['src/**/*.test.ts', 'tests/**/*.test.ts'],
    environment: 'node',
  },
});
