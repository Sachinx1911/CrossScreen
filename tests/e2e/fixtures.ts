import type { Page } from '@playwright/test';

/**
 * Shared setup for the join flow.
 *
 * The one thing that cannot be real here is the screen capture: a headless
 * browser has no screen, and the permission prompt has nobody to answer it. A
 * canvas-backed `MediaStream` stands in — it is a genuine MediaStream carrying
 * genuine frames through the genuine encoder, so everything downstream of the
 * capture is the real path.
 */

/** Replace `getDisplayMedia` before any application code runs. */
export async function stubScreenCapture(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 640;
    canvas.height = 360;
    const context = canvas.getContext('2d');

    let frame = 0;
    setInterval(() => {
      if (context === null) return;
      context.fillStyle = '#101828';
      context.fillRect(0, 0, 640, 360);
      context.fillStyle = '#2f6fed';
      context.font = '32px sans-serif';
      // Moving content, so a frozen stream is distinguishable from a live one.
      context.fillText(`frame ${frame++}`, 40, 190);
    }, 100);

    const stream = canvas.captureStream(15);
    Object.defineProperty(navigator.mediaDevices, 'getDisplayMedia', {
      configurable: true,
      value: () => Promise.resolve(stream),
    });
  });
}

/** The safety notice is shown once per device; tests are not that device. */
export async function skipSafetyNotice(page: Page): Promise<void> {
  await page.addInitScript(() => {
    localStorage.setItem('crossscreen.seen-safety-notice', String(Date.now()));
  });
}

/**
 * Fail a test if the page logs an error.
 *
 * React reports invalid markup, bad hooks and failed renders to the console
 * and then carries on, so a page can be visibly working and quietly broken.
 * The first end-to-end run found nested `<p>` elements this way — invalid
 * HTML that no type check or lint rule would ever have seen.
 */
export function failOnConsoleErrors(page: Page, collected: string[]): void {
  page.on('console', (message) => {
    if (message.type() !== 'error') return;
    const text = message.text();
    // Network failures are asserted on directly where they are expected, and
    // a refused fetch is not a defect in the page.
    if (/Failed to load resource|net::ERR_/i.test(text)) return;
    collected.push(text);
  });
}
