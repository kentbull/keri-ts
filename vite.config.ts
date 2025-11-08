import { defineConfig } from 'vite';
import { resolve } from 'path';

export default defineConfig({
  build: {
    lib: {
      entry: resolve(__dirname, 'mod.ts'),
      formats: ['es'],
      fileName: () => 'mod.js',
    },
    rollupOptions: {
      external: ['effection', 'lmdb', 'commander'],
      output: {
        format: 'es',
        entryFileNames: '[name].js',
      },
    },
    target: 'node20',
    outDir: 'dist',
    emptyOutDir: true,
    ssr: true, // Enable SSR mode for Node.js
  },
  resolve: {
    alias: {
      '@app/': resolve(__dirname, 'src/app/'),
      '@db/': resolve(__dirname, 'src/db/'),
      '@core/': resolve(__dirname, 'src/core/'),
      '@test/': resolve(__dirname, 'test/'),
    },
  },
  ssr: {
    noExternal: [], // Don't bundle any dependencies
  },
  test: {
    globals: true,
    environment: 'node',
    include: ['test/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
    },
    // Enable debugging support
    testTimeout: 10000,
  },
});

