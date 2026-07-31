import { defineConfig } from 'vitest/config';
import path from 'node:path';

// The Cloudflare Workers pool (workerd) requires macOS 13.5+, which this
// machine does not satisfy, so tests run on Node with `cloudflare:workers`
// aliased to a shim and D1 backed by real SQLite via node:sqlite.
export default defineConfig({
  resolve: {
    alias: {
      'cloudflare:workers': path.resolve(__dirname, 'test/cloudflare-workers.ts'),
    },
  },
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
    setupFiles: ['./test/setup.ts'],
  },
});
