import { resolve } from 'node:path';
import { defineConfig } from 'vite';

/**
 * Builds only the renderer. The main process is compiled by tsc
 * (`tsconfig.main.json`) because it runs in Node, not a browser.
 *
 * `base: './'` matters: the renderer is loaded from a file:// URL, so absolute
 * asset paths would not resolve.
 */
export default defineConfig({
  root: resolve(import.meta.dirname, 'src/renderer'),
  // `envDir` defaults to `root`, which would look for .env files inside
  // src/renderer. They belong beside package.json, with the rest of the app's
  // configuration.
  envDir: import.meta.dirname,
  base: './',
  build: {
    outDir: resolve(import.meta.dirname, 'dist/renderer'),
    emptyOutDir: true,
    target: 'es2022',
  },
});
