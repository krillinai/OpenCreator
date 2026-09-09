import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
    maxWorkers: 2,
    testTimeout: 10000
  }
});
