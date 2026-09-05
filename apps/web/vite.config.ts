import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    port: 5173,
    // Needed so a phone on the same network, or a tunnel, can reach the dev
    // server during the Phase 0.5 cross-network test.
    host: true,
  },
  build: { target: 'es2022' },
});
