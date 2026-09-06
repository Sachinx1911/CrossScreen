import { defineConfig, devices } from '@playwright/test';

/**
 * End-to-end configuration.
 *
 * Three servers, started together, because the flow under test spans all of
 * them — the API mints a session, signaling carries the negotiation, and the
 * page is served by Vite. Testing any one in isolation would miss precisely
 * the failures these tests exist for: the ones that only appear when the parts
 * are wired together.
 */

const SESSION_SECRET = 'an-end-to-end-test-secret-long-enough';

export default defineConfig({
  testDir: './specs',
  // A WebRTC connection has real waiting in it, and a machine under load is
  // slower than one that is not.
  timeout: 60_000,
  expect: { timeout: 15_000 },

  // Serially on purpose: the tests share three servers, and a flaky
  // "connection failed" caused by contention would be indistinguishable from
  // the real thing they are meant to detect.
  workers: 1,
  fullyParallel: false,
  forbidOnly: Boolean(process.env['CI']),
  retries: process.env['CI'] === undefined ? 0 : 1,
  reporter: process.env['CI'] === undefined ? 'list' : [['list'], ['html', { open: 'never' }]],

  use: {
    baseURL: 'http://127.0.0.1:5273',
    trace: 'retain-on-failure',
    video: 'retain-on-failure',
    launchOptions: {
      args: [
        // WebRTC between two contexts in one browser needs no camera, but
        // Chromium still gates some paths behind these in a headless run.
        '--use-fake-ui-for-media-stream',
        '--autoplay-policy=no-user-gesture-required',
      ],
    },
  },

  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],

  // Ports deliberately not the development ones, so a running `pnpm dev` does
  // not silently serve the tests and hide a build failure.
  webServer: [
    {
      command: 'node ../../services/api/src/server.ts',
      port: 8888,
      reuseExistingServer: false,
      env: {
        SESSION_SECRET,
        API_PORT: '8888',
        APP_ORIGIN: 'http://127.0.0.1:5273',
        LOG_LEVEL: 'warn',
      },
    },
    {
      command: 'node ../../services/signaling/src/server.ts',
      port: 8887,
      reuseExistingServer: false,
      env: { SESSION_SECRET, SIGNALING_PORT: '8887', LOG_LEVEL: 'warn' },
    },
    {
      command: 'pnpm --filter @crossscreen/web exec vite --port 5273 --strictPort',
      port: 5273,
      reuseExistingServer: false,
      env: { SIGNALING_TARGET: 'ws://127.0.0.1:8887', API_TARGET: 'http://127.0.0.1:8888' },
    },
  ],
});
