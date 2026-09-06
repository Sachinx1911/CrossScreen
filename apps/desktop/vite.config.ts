import { resolve } from 'node:path';

import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

/**
 * Builds only the renderer. The main process is compiled by tsc
 * (`tsconfig.main.json`) because it runs in Node, not a browser.
 *
 * `base: './'` matters: assets are fetched relative to `app://bundle`, and
 * absolute paths would not resolve.
 */
export default defineConfig({
  plugins: [react(), tailwindcss()],
  root: resolve(import.meta.dirname, 'src/renderer'),
  // `envDir` defaults to `root`, which would look for .env files inside
  // src/renderer. They belong beside package.json with the rest of the app's
  // configuration.
  envDir: import.meta.dirname,
  base: './',
  build: {
    outDir: resolve(import.meta.dirname, 'dist/renderer'),
    emptyOutDir: true,
    target: 'es2022',
  },
});
