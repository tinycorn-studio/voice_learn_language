import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  resolve: {
    alias: {
      '@voice-chat/shared': path.resolve(__dirname, 'packages/shared/src/index.ts'),
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    include: ['packages/**/*.test.ts', 'apps/**/*.test.{ts,tsx}', 'tests/**/*.test.ts'],
  },
});
