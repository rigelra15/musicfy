import { youtubeRelayPlugin } from './server/youtubeRelay.ts';
import preact from '@preact/preset-vite';
import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  plugins: [preact(), youtubeRelayPlugin()],
  build: {
    target: 'es2019',
  },
});
