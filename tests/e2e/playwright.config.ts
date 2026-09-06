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
        // Chromium only; ignored elsewhere. WebRTC between two contexts in one
        // browser needs no camera, but Chromium still gates some paths behind
        // these in a headless run.
        '--use-fake-ui-for-media-stream',
        '--autoplay-policy=no-user-gesture-required',
      ],
    },
  },

  /**
   * Chromium by default; the others behind `E2E_ALL_BROWSERS=1`.
   *
   * The viewer's support commitment is Chrome, Edge and Firefox on desktop,
   * with Safari best-effort (ADR-0010), so all three belong here in principle.
   * What actually happened when they were run, on Windows, 2026-09-06:
   *
   * - **Chromium** — 8 of 8 pass. Edge is Chromium and adds nothing over it.
   * - **Firefox** — does not launch at all: `browserType.launch: spawn
   *   UNKNOWN`. An environment problem on this machine, not a product one, and
   *   nothing about the application was exercised either way.
   * - **WebKit** — the two tests that need no WebRTC pass; the six that
   *   negotiate a peer connection time out. Playwright's WebKit build is not
   *   Safari, and its WebRTC support is materially thinner, so this is weak
   *   evidence about Safari rather than a finding about it.
   *
   * Keeping a red suite for either reason would train everyone to ignore it.
   * Safari is answered properly by running the flow on real macOS, which is
   * now available (Phase 3b), and Firefox by running this on a machine where
   * it starts.
   */
  projects:
    process.env['E2E_ALL_BROWSERS'] === '1'
      ? [
          { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
          { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
          { name: 'webkit', use: { ...devices['Desktop Safari'] } },
        ]
      : [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],

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
