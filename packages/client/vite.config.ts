import { defineConfig } from 'vite';
import path from 'path';

export default defineConfig({
  root: '.',
  publicDir: 'public',
  server: {
    port: 3000,
    host: true,
  },
  resolve: {
    alias: {
      '@garam/shared': path.resolve(__dirname, '../shared/src'),
    },
  },
});
