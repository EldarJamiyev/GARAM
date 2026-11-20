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
  build: {
    chunkSizeWarningLimit: 650,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules/three/examples')) {
            return 'vendor-three-addons';
          }
          if (id.includes('node_modules/three')) {
            return 'vendor-three';
          }
          if (id.includes('/packages/shared/')) {
            return 'garam-shared';
          }
          return undefined;
        },
      },
    },
  },
});
