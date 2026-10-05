import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    environment: 'jsdom',
    minWorkers: 1,
    maxWorkers: 1,
    setupFiles: [
      path.resolve(__dirname, './test/setup-test-database.ts'),
      path.resolve(__dirname, './test/setup-shim.ts'),
      path.resolve(__dirname, './test/setup-jest-dom.ts'),
    ],
  },
});
