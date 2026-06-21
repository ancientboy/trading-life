import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
  base: '/trading/life/',
  build: {
    outDir: '../dashboard/static/life',
    emptyOutDir: true,
    assetsDir: 'assets',
    sourcemap: false,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules/react-dom') || id.includes('node_modules/react/')) return 'vendor-react';
          if (id.includes('node_modules/three') || id.includes('@react-three')) return 'vendor-three';
          if (id.includes('lightweight-charts')) return 'vendor-charts';
        },
      },
    },
  },
  server: {
    port: 5174,
    proxy: {
      '/trading/api': { target: 'http://43.98.167.204', changeOrigin: true },
    },
  },
});
