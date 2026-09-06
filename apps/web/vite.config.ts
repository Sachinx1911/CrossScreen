import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const SIGNALING_TARGET = process.env['SIGNALING_TARGET'] ?? 'ws://127.0.0.1:8787';
const API_TARGET = process.env['API_TARGET'] ?? 'http://127.0.0.1:8788';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    // So a phone on the same network, or a tunnel, can reach the dev server.
    host: true,

    // A quick tunnel gets a fresh random hostname every run, and Vite blocks
    // hosts it does not recognise.
    allowedHosts: ['.trycloudflare.com', '.ngrok-free.app', 'localhost'],

    /**
     * One tunnel serves everything: the page at `/`, signaling at `/ws`, the
     * API at `/api`. Without this the cross-network test needs three URLs kept
     * in sync, and the clients need none of them configured.
     */
    proxy: {
      '/ws': {
        target: SIGNALING_TARGET,
        ws: true,
        rewrite: (path) => path.replace(/^\/ws/, ''),
      },
      '/api': { target: API_TARGET, changeOrigin: true },
    },
  },
  build: { target: 'es2022' },
});
