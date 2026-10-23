import preact from '@preact/preset-vite';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [preact()],
  base: process.env.PAGES_BASE_PATH ?? '/',
  build: { target: 'es2017' },
  test: { environment: 'node' },
});
