import { defineConfig } from 'vite';
import preact from '@preact/preset-vite';

// Relative base so the build works at https://<user>.github.io/<repo>/ as well as locally.
export default defineConfig({
  base: './',
  plugins: [preact()],
  worker: { format: 'es' },
  build: { target: 'es2020', sourcemap: false },
  test: {
    include: ['tests/**/*.test.ts'],
    testTimeout: 30000,
  },
} as any);
