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
  },
  server: {
    port: 5174,
    proxy: {
      '/trading/api': { target: 'http://43.98.167.204', changeOrigin: true },
    },
  },
});
