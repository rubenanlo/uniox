import { defineConfig } from 'vitest/config';
import { resolve } from 'node:path';

export default defineConfig({
  resolve: {
    alias: {
      '@app/shared': resolve(__dirname, 'packages/shared/src/index.ts'),
      '@app/db': resolve(__dirname, 'packages/db/src/index.ts'),
      '@app/email-render': resolve(__dirname, 'packages/email-render/src/index.ts'),
    },
  },
  test: {
    include: ['packages/*/test/**/*.test.ts'],
    pool: 'forks',
  },
});
