import { defineConfig } from 'vite';
import path from 'path';

export default defineConfig({
  root: '.',
  publicDir: 'public',
  envPrefix: 'VITE_',
  server: {
    port: 3000,
    host: true,
  },
  resolve: {
    dedupe: ['three'],
    alias: {
      '@garam/shared': path.resolve(__dirname, '../shared/src'),
    },
  },
});
