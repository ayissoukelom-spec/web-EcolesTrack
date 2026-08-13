import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    environment: 'jsdom',
    setupFiles: [
      path.resolve(__dirname, './test/setup-shim.ts'),
      path.resolve(__dirname, './test/setup-jest-dom.ts'),
    ],
  },
});
