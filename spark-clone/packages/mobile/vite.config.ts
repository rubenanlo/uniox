import { resolve } from 'node:path';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

/** The Uniox phone app: a static PWA. `pnpm --filter @app/mobile build` → dist/. */
export default defineConfig({
  base: './',
  plugins: [react()],
  resolve: {
    alias: { '@app/shared': resolve(__dirname, '../shared/src/index.ts') },
  },
  server: { host: true, port: 5180 },
  build: { outDir: 'dist', emptyOutDir: true, sourcemap: false },
});
