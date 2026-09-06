import { expect, test, type Page } from '@playwright/test';

import { failOnConsoleErrors, skipSafetyNotice, stubScreenCapture } from '../fixtures.ts';

/**
 * The whole loop, across two browser contexts and three servers.
 *
 * These exist because of what actually went wrong while building it. Every
 * unit test passed and the product was still broken three separate ways: the
 * video stayed black while the connection reported itself healthy, a cancelled
 * start went on to join anyway, and a viewer who left before being allowed
 * left their prompt behind. Only running the whole thing found any of them.
 */

/**
 * Anything a page logs as an error, across every test.
 *
 * Asserted after each one rather than thrown at the moment it happens, so the
 * failure names the test it belongs to.
 */
const consoleErrors: string[] = [];

test.beforeEach(() => {
  consoleErrors.length = 0;
});

test.afterEach(() => {
  expect(consoleErrors, 'the page logged errors').toEqual([]);
});

async function startSharing(page: Page): Promise<{ code: string; link: string }> {
  failOnConsoleErrors(page, consoleErrors);
  await stubScreenCapture(page);
  await skipSafetyNotice(page);
  await page.goto('/share');

  await page.getByRole('button', { name: 'Choose a screen' }).click();
  await expect(page.getByText('You are sharing your screen')).toBeVisible();

  const code = (await page.locator('code').first().innerText()).replace(/\s/g, '');
  const link = await page.locator('code').nth(1).innerText();
  return { code, link };
}

test('a viewer sees the screen once the host allows them', async ({ browser }) => {
  const host = await browser.newContext();
  const guest = await browser.newContext();
  const sharer = await host.newPage();
  const viewer = await guest.newPage();
  failOnConsoleErrors(viewer, consoleErrors);

  const { link } = await startSharing(sharer);
  await expect(sharer.getByText('Send the code or link to someone')).toBeVisible();

  await viewer.goto(new URL(link).pathname);

  // Nothing is shared while the host is deciding, and the viewer is told so
  // rather than being left on a silent spinner.
  await expect(viewer.getByText('Waiting for the host to let you in…')).toBeVisible();
  await expect(viewer.locator('video')).toHaveCount(0);

  await expect(sharer.getByText('Someone wants to view your screen')).toBeVisible();
  await sharer.getByRole('button', { name: 'Allow' }).click();

  await expect(viewer.locator('video')).toBeVisible();
  await expect(sharer.getByText('1 person is watching')).toBeVisible();

  // A video element can be present, connected and completely blank — that is
  // exactly the bug this line exists for.
  await expect
    .poll(
      async () =>
        viewer.locator('video').evaluate((el: HTMLVideoElement) => ({
          width: el.videoWidth,
          playing: !el.paused && el.currentTime > 0,
        })),
      { timeout: 20_000 },
    )
    .toEqual(expect.objectContaining({ playing: true }));

  const size = await viewer
    .locator('video')
    .evaluate((el: HTMLVideoElement) => `${el.videoWidth}x${el.videoHeight}`);
  expect(size).not.toBe('0x0');

  await host.close();
  await guest.close();
});

test('the code and link can be copied, and say so', async ({ browser, context }) => {
  // A share link exists to be pasted into a message. Without a copy button it
  // has to be selected by hand out of a monospace box, and without the
  // confirmation people press repeatedly, because a clipboard write is
  // otherwise completely invisible.
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);

  const host = await browser.newContext();
  await host.grantPermissions(['clipboard-read', 'clipboard-write']);
  const sharer = await host.newPage();

  const { link } = await startSharing(sharer);

  // The code and the link each need one.
  const copyButtons = sharer.getByRole('button', { name: /^Copy / });
  await expect(copyButtons).toHaveCount(2);

  await sharer.getByRole('button', { name: 'Copy Share link' }).click();
  await expect(sharer.getByRole('button', { name: 'Copy Share link' })).toHaveText('Copied');

  const clipboard = await sharer.evaluate(() => navigator.clipboard.readText());
  expect(clipboard).toBe(link);

  await host.close();
});

test('the status does not claim to be connecting when nobody is there', async ({ browser }) => {
  // "Connecting…" with no viewer is a lie — there is nothing to connect to
  // yet — and it reads as something being stuck.
  const host = await browser.newContext();
  const sharer = await host.newPage();

  await startSharing(sharer);

  await expect(sharer.getByText('Ready to share')).toBeVisible();
  await expect(sharer.getByText('Send the code or link to someone')).toBeVisible();
  await expect(sharer.locator('body')).not.toContainText('Connecting…');

  await host.close();
});

test('exactly one prompt appears for one viewer', async ({ browser }) => {
  // React remounting an effect used to produce two, because a stopped session
  // went on to open a socket and join anyway.
  const host = await browser.newContext();
  const guest = await browser.newContext();
  const sharer = await host.newPage();
  const viewer = await guest.newPage();
  failOnConsoleErrors(viewer, consoleErrors);

  const { link } = await startSharing(sharer);
  await viewer.goto(new URL(link).pathname);

  await expect(sharer.getByRole('alertdialog')).toHaveCount(1);
  // Held rather than snapshotted: a duplicate arriving late is the failure.
  await sharer.waitForTimeout(2000);
  await expect(sharer.getByRole('alertdialog')).toHaveCount(1);

  await host.close();
  await guest.close();
});

test('switching what is shared does not interrupt anyone watching', async ({ browser }) => {
  // Picking the wrong window is an ordinary mistake. Answering it by stopping
  // and starting again drops every viewer and makes each ask permission a
  // second time, which is out of all proportion to the mistake.
  const host = await browser.newContext();
  const guest = await browser.newContext();
  const sharer = await host.newPage();
  const viewer = await guest.newPage();
  failOnConsoleErrors(viewer, consoleErrors);

  const { link } = await startSharing(sharer);
  await viewer.goto(new URL(link).pathname);
  await sharer.getByRole('button', { name: 'Allow' }).click();
  await expect(viewer.locator('video')).toBeVisible();

  await expect
    .poll(async () =>
      viewer.locator('video').evaluate((el: HTMLVideoElement) => !el.paused && el.currentTime > 0),
    )
    .toBe(true);

  const before = await viewer.locator('video').evaluate((el: HTMLVideoElement) => el.currentTime);

  await sharer.getByRole('button', { name: 'Share something else' }).click();
  await sharer.waitForTimeout(1500);

  // Still watching, still the same session, still playing — no reconnection,
  // no second approval, no gap.
  await expect(viewer.locator('video')).toBeVisible();
  await expect(sharer.getByText('1 person is watching')).toBeVisible();
  await expect(viewer.getByText(/ended|declined|unreachable/i)).toHaveCount(0);

  await expect
    .poll(async () => viewer.locator('video').evaluate((el: HTMLVideoElement) => el.currentTime))
    .toBeGreaterThan(before);

  await host.close();
  await guest.close();
});

test('switching to smooth video does not interrupt anyone watching', async ({ browser }) => {
  // The control exists because sharing a playing video with the text setting
  // makes it look frozen — sharp frames arriving too slowly. Changing it must
  // not cost the viewer their session, or nobody will change it mid-call.
  const host = await browser.newContext();
  const guest = await browser.newContext();
  const sharer = await host.newPage();
  const viewer = await guest.newPage();
  failOnConsoleErrors(viewer, consoleErrors);

  const { link } = await startSharing(sharer);
  await viewer.goto(new URL(link).pathname);
  await sharer.getByRole('button', { name: 'Allow' }).click();
  await expect(viewer.locator('video')).toBeVisible();

  await expect(sharer.getByText('Sharp text')).toBeVisible();
  await sharer.getByText('Smooth video').click();

  const before = await viewer.locator('video').evaluate((el: HTMLVideoElement) => el.currentTime);

  await expect(sharer.getByText('1 person is watching')).toBeVisible();
  await expect(viewer.getByText(/ended|declined|unreachable/i)).toHaveCount(0);
  await expect
    .poll(async () => viewer.locator('video').evaluate((el: HTMLVideoElement) => el.currentTime))
    .toBeGreaterThan(before);

  await host.close();
  await guest.close();
});

test('the viewer can go fullscreen and come back', async ({ browser }) => {
  // Someone watching is looking at content laid out for a whole display, now
  // inside a window inside another display. Every pixel of chrome around it
  // costs legibility, which is the one thing this cannot afford to lose.
  const host = await browser.newContext();
  const guest = await browser.newContext();
  const sharer = await host.newPage();
  const viewer = await guest.newPage();
  failOnConsoleErrors(viewer, consoleErrors);

  const { link } = await startSharing(sharer);
  await viewer.goto(new URL(link).pathname);
  await sharer.getByRole('button', { name: 'Allow' }).click();
  await expect(viewer.locator('video')).toBeVisible();

  // The headless shell does not always report fullscreen as available, and a
  // button that is correctly hidden is not a failure to report.
  const available = await viewer.evaluate(() => document.fullscreenEnabled);
  test.skip(!available, 'this browser build reports no fullscreen support');

  await viewer.getByRole('button', { name: 'Fullscreen' }).click();
  await expect(viewer.getByRole('button', { name: 'Exit fullscreen' })).toBeVisible();
  await expect
    .poll(async () => viewer.evaluate(() => document.fullscreenElement !== null))
    .toBe(true);

  // The status has to stay reachable: a viewer who cannot see whether the
  // connection is alive, or get out, is stuck.
  await expect(viewer.getByText('Connected')).toBeVisible();

  const before = await viewer.locator('video').evaluate((el: HTMLVideoElement) => el.currentTime);

  await viewer.getByRole('button', { name: 'Exit fullscreen' }).click();
  await expect(viewer.getByRole('button', { name: 'Fullscreen' })).toBeVisible();

  // Nothing about the session changed — fullscreen is presentation only.
  await expect(sharer.getByText('1 person is watching')).toBeVisible();
  await expect
    .poll(async () => viewer.locator('video').evaluate((el: HTMLVideoElement) => el.currentTime))
    .toBeGreaterThan(before);

  await host.close();
  await guest.close();
});

test('a live share offers a way to stop, and stopping ends it for the viewer', async ({
  browser,
}) => {
  // Reported as missing. It was there; the session had failed to start, so the
  // sharing state was never reached. Worth a test either way — a screen being
  // shared with no visible way to stop it is the worst button to lose.
  const host = await browser.newContext();
  const guest = await browser.newContext();
  const sharer = await host.newPage();
  const viewer = await guest.newPage();
  failOnConsoleErrors(viewer, consoleErrors);

  const { link } = await startSharing(sharer);

  // Visible without scrolling. It was rendered before and sat below the fold,
  // behind a full-width preview, which is indistinguishable from missing.
  const stopButton = sharer.getByRole('button', { name: 'Stop sharing' });
  await expect(stopButton).toBeVisible();

  const viewport = sharer.viewportSize();
  const box = await stopButton.boundingBox();
  if (viewport === null || box === null) throw new Error('the stop button has no position');
  expect(box.y + box.height).toBeLessThanOrEqual(viewport.height);

  await viewer.goto(new URL(link).pathname);
  await sharer.getByRole('button', { name: 'Allow' }).click();
  await expect(viewer.locator('video')).toBeVisible();

  await sharer.getByRole('button', { name: 'Stop sharing' }).click();

  await expect(viewer.getByText(/ended|lost/i)).toBeVisible();
  await expect(sharer.getByRole('button', { name: 'Stop sharing' })).toHaveCount(0);

  await host.close();
  await guest.close();
});

test('a rejected viewer is told, and never receives a stream', async ({ browser }) => {
  const host = await browser.newContext();
  const guest = await browser.newContext();
  const sharer = await host.newPage();
  const viewer = await guest.newPage();
  failOnConsoleErrors(viewer, consoleErrors);

  const { link } = await startSharing(sharer);
  await viewer.goto(new URL(link).pathname);

  await expect(sharer.getByRole('alertdialog')).toBeVisible();
  await sharer.getByRole('button', { name: 'Reject' }).click();

  await expect(viewer.getByText('The host declined your request to join.')).toBeVisible();
  await expect(viewer.locator('video')).toHaveCount(0);
  await expect(sharer.getByText('Send the code or link to someone')).toBeVisible();

  await host.close();
  await guest.close();
});

test('a viewer nobody answers is told, and stops waiting on their own', async ({ browser }) => {
  // JOIN_REQUEST_TIMEOUT_MS is turned down to 4s for this suite (see
  // playwright.config.ts) — a host who never responds is the ordinary case,
  // not a bug, and a viewer left on "Waiting…" forever is indistinguishable
  // from a hang.
  const host = await browser.newContext();
  const guest = await browser.newContext();
  const sharer = await host.newPage();
  const viewer = await guest.newPage();
  failOnConsoleErrors(viewer, consoleErrors);

  const { link } = await startSharing(sharer);
  await viewer.goto(new URL(link).pathname);

  await expect(sharer.getByRole('alertdialog')).toBeVisible();
  await expect(viewer.getByText('Waiting for the host to let you in…')).toBeVisible();

  await expect(viewer.getByText("The host didn't respond. You can try again.")).toBeVisible({
    timeout: 10_000,
  });
  await expect(viewer.locator('video')).toHaveCount(0);

  // Answered, not merely abandoned: the host's prompt clears too, the same
  // way it does when a viewer leaves while still pending.
  await expect(sharer.getByRole('alertdialog')).toHaveCount(0);

  await host.close();
  await guest.close();
});

test('a viewer who leaves while waiting takes their prompt with them', async ({ browser }) => {
  // Otherwise the host is left able to allow someone who has already gone.
  const host = await browser.newContext();
  const guest = await browser.newContext();
  const sharer = await host.newPage();
  const viewer = await guest.newPage();
  failOnConsoleErrors(viewer, consoleErrors);

  const { link } = await startSharing(sharer);
  await viewer.goto(new URL(link).pathname);
  await expect(sharer.getByRole('alertdialog')).toBeVisible();

  await guest.close();
  await expect(sharer.getByRole('alertdialog')).toHaveCount(0);

  await host.close();
});

test('the host leaving ends the session for the viewer', async ({ browser }) => {
  const host = await browser.newContext();
  const guest = await browser.newContext();
  const sharer = await host.newPage();
  const viewer = await guest.newPage();
  failOnConsoleErrors(viewer, consoleErrors);

  const { link } = await startSharing(sharer);
  await viewer.goto(new URL(link).pathname);
  await sharer.getByRole('button', { name: 'Allow' }).click();
  await expect(viewer.locator('video')).toBeVisible();

  await host.close();

  await expect(viewer.getByText('The host ended the session.')).toBeVisible();

  await guest.close();
});

test('joining by typed code works the same as by link', async ({ browser }) => {
  const host = await browser.newContext();
  const guest = await browser.newContext();
  const sharer = await host.newPage();
  const viewer = await guest.newPage();
  failOnConsoleErrors(viewer, consoleErrors);

  const { code } = await startSharing(sharer);

  await viewer.goto('/join');
  // Typed with the spaces a person reading it aloud would produce.
  await viewer
    .getByLabel('Session code, or paste a link')
    .fill(`${code.slice(0, 3)} ${code.slice(3)}`);
  await viewer.getByRole('button', { name: 'Join session' }).click();

  await expect(sharer.getByText('Typed your session code')).toBeVisible();

  await host.close();
  await guest.close();
});

test('a code with no session behind it is refused in plain language', async ({ page }) => {
  failOnConsoleErrors(page, consoleErrors);
  await page.goto('/join');
  await page.getByLabel('Session code, or paste a link').fill('000000');
  await page.getByRole('button', { name: 'Join session' }).click();

  const message = page.getByText(/couldn't find that session/i);
  await expect(message).toBeVisible();
  // No jargon, ever — architecture §66.
  await expect(page.locator('body')).not.toContainText(/SESSION_NOT_FOUND|ICE|SDP/);
});

test('a code that is not six digits is caught before anything is sent', async ({ page }) => {
  failOnConsoleErrors(page, consoleErrors);
  await page.goto('/join');
  await page.getByLabel('Session code, or paste a link').fill('123');
  await page.getByRole('button', { name: 'Join session' }).click();

  await expect(
    page.getByText('A session code is six digits. Check it and try again.'),
  ).toBeVisible();
});
