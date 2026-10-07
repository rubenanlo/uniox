import { defineConfig, externalizeDepsPlugin } from 'electron-vite';
import { resolve } from 'node:path';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

const workspacePkgs = ['@app/shared', '@app/db', '@app/email-render'];

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin({ exclude: workspacePkgs })],
    resolve: {
      alias: {
        '@app/shared': resolve('packages/shared/src/index.ts'),
        '@app/db': resolve('packages/db/src/index.ts'),
      },
    },
    build: {
      rollupOptions: {
        // native module: must resolve from node_modules at runtime
        external: ['better-sqlite3'],
        input: {
          index: resolve('packages/main/src/index.ts'),
          sync: resolve('packages/sync/src/entry.ts'),
        },
      },
    },
  },
  preload: {
    plugins: [externalizeDepsPlugin({ exclude: workspacePkgs })],
    resolve: {
      alias: {
        '@app/shared': resolve('packages/shared/src/index.ts'),
      },
    },
    build: {
      rollupOptions: {
        input: { index: resolve('packages/main/src/preload.ts') },
      },
    },
  },
  renderer: {
    root: resolve('packages/renderer'),
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: {
        '@app/shared': resolve('packages/shared/src/index.ts'),
        '@app/email-render': resolve('packages/email-render/src/index.ts'),
        '@': resolve('packages/renderer/src'),
      },
    },
    build: {
      rollupOptions: {
        input: { index: resolve('packages/renderer/index.html') },
      },
    },
  },
});
