import { defineConfig } from 'vite';
import preact from '@preact/preset-vite';
import { devApi } from './scripts/dev-api.ts';

export default defineConfig({
  // Relative addresses, so the very same build works on the website, in a
  // sub-folder, and from inside the Android app.
  base: './',
  plugins: [preact(), devApi()],
  server: { port: 5210, strictPort: true, host: true },
  preview: { port: 5211, strictPort: true, host: true },
  build: {
    target: 'es2020',
    cssMinify: true,
    chunkSizeWarningLimit: 700,
  },
});
