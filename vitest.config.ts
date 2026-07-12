import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    environment: 'jsdom',  // Use jsdom for React component tests (DOM API available)
    // Apply global setup to fix TextEncoder/TextDecoder shim before TypeScript transformation
    setupFiles: [path.resolve(__dirname, './test/setup-shim.ts')],
  },
});
