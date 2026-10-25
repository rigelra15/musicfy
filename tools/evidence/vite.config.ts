import preact from '@preact/preset-vite';
import { defineConfig } from 'vite';

export default defineConfig({
  root: import.meta.dirname,
  base: './',
  plugins: [preact()],
  build: { target: 'es2019', outDir: '../../artifacts/t7-evidence/dist', emptyOutDir: true },
});
