import { resolve } from 'node:path';
import { defineConfig } from 'vite';

/**
 * Builds only the renderer. The main process is compiled by tsc
 * (`tsconfig.main.json`) because it runs in Node, not a browser.
 *
 * `base: './'` emits `./assets/…` rather than `/assets/…`. The reason has
 * changed and the old one is worth not repeating: this used to be load-bearing
 * because the renderer was loaded from a `file://` URL, where an absolute path
 * resolves against the filesystem root. It is served from `app://bundle` now —
 * that move is what let the CSP be tight, since `'self'` matches nothing on
 * `file://` — and a real origin resolves absolute paths perfectly well.
 *
 * Relative stays because it keeps the bundle indifferent to where it is
 * mounted, which is a smaller claim than the one this comment used to make.
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
