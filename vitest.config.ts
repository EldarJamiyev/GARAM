import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  resolve: {
    alias: {
      '@garam/shared': path.resolve(__dirname, 'packages/shared/src'),
    },
  },
  test: {
    globals: true,
    exclude: ['**/node_modules/**', '**/dist/**'],
  },
});
