import { defineConfig } from 'vite';

const SIGNALING_TARGET = process.env['SIGNALING_TARGET'] ?? 'ws://127.0.0.1:8787';

export default defineConfig({
  server: {
    port: 5173,
    // So a phone on the same network, or a tunnel, can reach the dev server.
    host: true,

    // A quick tunnel gets a fresh random hostname every run, and Vite blocks
    // hosts it does not recognise.
    allowedHosts: ['.trycloudflare.com', '.ngrok-free.app', 'localhost'],

    // The viewer and the signaling server are then reachable through ONE
    // tunnel: the page at `/`, signaling at `/ws`. Without this the
    // cross-network test needs two tunnels and two URLs to keep in sync, and
    // `apps/web/src/config.ts` already falls back to same-origin `/ws`, so the
    // viewer needs no configuration at all.
    proxy: {
      '/ws': {
        target: SIGNALING_TARGET,
        ws: true,
        rewrite: (path) => path.replace(/^\/ws/, ''),
      },
    },
  },
  build: { target: 'es2022' },
});
