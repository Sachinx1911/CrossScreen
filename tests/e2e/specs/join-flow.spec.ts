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

test('a second viewer is told the session is full, without bothering the host', async ({
  browser,
}) => {
  // Phase 1 is one sharer, one viewer (architecture §11). No client code
  // change was needed for this to read correctly — the same generic
  // non-retryable-error handling that already covers a rejected or timed-out
  // join covers SESSION_FULL too.
  const host = await browser.newContext();
  const firstGuest = await browser.newContext();
  const secondGuest = await browser.newContext();
  const sharer = await host.newPage();
  const firstViewer = await firstGuest.newPage();
  const secondViewer = await secondGuest.newPage();
  failOnConsoleErrors(firstViewer, consoleErrors);
  failOnConsoleErrors(secondViewer, consoleErrors);

  const { link } = await startSharing(sharer);
  await firstViewer.goto(new URL(link).pathname);
  await sharer.getByRole('button', { name: 'Allow' }).click();
  await expect(firstViewer.locator('video')).toBeVisible();

  await secondViewer.goto(new URL(link).pathname);

  await expect(secondViewer.getByText('This session is already full.')).toBeVisible();
  await expect(secondViewer.locator('video')).toHaveCount(0);
  // The host is never shown a prompt it could not act on.
  await expect(sharer.getByRole('alertdialog')).toHaveCount(0);
  // And the first viewer is completely undisturbed by the second one's visit.
  await expect(firstViewer.locator('video')).toBeVisible();

  await host.close();
  await firstGuest.close();
  await secondGuest.close();
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

test('the host closing their tab ends the session for the viewer', async ({ browser }) => {
  // Closing the *page* rather than the whole context on purpose: this is what
  // a real "close tab" fires `pagehide` for, which is how a host who is
  // plainly finished is told apart from one whose socket merely dropped
  // (§2.3) — a dropped socket is now held for a grace period rather than
  // ending the session outright.
  const host = await browser.newContext();
  const guest = await browser.newContext();
  const sharer = await host.newPage();
  const viewer = await guest.newPage();
  failOnConsoleErrors(viewer, consoleErrors);

  const { link } = await startSharing(sharer);
  await viewer.goto(new URL(link).pathname);
  await sharer.getByRole('button', { name: 'Allow' }).click();
  await expect(viewer.locator('video')).toBeVisible();

  await sharer.close();

  await expect(viewer.getByText('The host ended the session.')).toBeVisible();

  await host.close();
  await guest.close();
});

test('a session left claimed and empty expires, and tells the host why in plain language', async ({
  browser,
}) => {
  // SESSION_IDLE_TIMEOUT_MS and SESSION_SWEEP_INTERVAL_MS are turned down for
  // this suite (see playwright.config.ts) so this does not cost 5 real
  // minutes. This is the path that used to leak the raw protocol word
  // "idle_timeout" straight to the host — the viewer side already translated
  // it into a sentence, the host side just passed the enum through.
  //
  // Closing the *page* rather than the whole context: that is what fires
  // `pagehide`, which is how a viewer who is plainly done is told apart from
  // one whose socket merely dropped (§2.3) — a dropped socket is now held for
  // a grace period, and the idle clock does not even start until it gives up.
  const host = await browser.newContext();
  const guest = await browser.newContext();
  const sharer = await host.newPage();
  const viewer = await guest.newPage();
  failOnConsoleErrors(viewer, consoleErrors);

  const { link } = await startSharing(sharer);
  await viewer.goto(new URL(link).pathname);
  await sharer.getByRole('button', { name: 'Allow' }).click();
  await expect(viewer.locator('video')).toBeVisible();

  await viewer.close();

  await expect(sharer.getByText('The session ended because nobody was watching.')).toBeVisible({
    timeout: 10_000,
  });
  await expect(sharer.locator('body')).not.toContainText('idle_timeout');

  await host.close();
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

test('forcing relay with no TURN configured refuses to start, in plain language', async ({
  page,
}) => {
  // This suite's signaling/api servers carry no CLOUDFLARE_TURN_KEY_ID (see
  // playwright.config.ts), the ordinary state of a fresh clone. `?relay=1`
  // used to mean the sharer would try anyway and gather nothing at all —
  // indistinguishable from a genuine no-path failure. It now refuses up
  // front and says why, matching what ViewerSession already did.
  failOnConsoleErrors(page, consoleErrors);
  await stubScreenCapture(page);
  await skipSafetyNotice(page);
  await page.goto('/share?relay=1');

  await page.getByRole('button', { name: 'Choose a screen' }).click();

  await expect(
    page.getByText('TURN is required to force the relay path, and none is configured.'),
  ).toBeVisible();
  await expect(page.getByText('You are sharing your screen')).toHaveCount(0);
});

test('the safety notice blocks a first share until it is acknowledged', async ({ page }) => {
  // Deliberately not calling skipSafetyNotice — this is the one test that
  // needs the notice to actually be there (phase-3a-production.md §3.2).
  failOnConsoleErrors(page, consoleErrors);
  await stubScreenCapture(page);
  await page.goto('/share');

  await expect(page.getByText('Only share with people you know.')).toBeVisible();
  // Nothing about actually sharing is reachable while the notice is up —
  // this is what makes it a gate rather than a banner.
  await expect(page.getByRole('button', { name: 'Choose a screen' })).toHaveCount(0);

  await page.getByRole('button', { name: 'I understand' }).click();
  await expect(page.getByRole('button', { name: 'Choose a screen' })).toBeVisible();
  await expect(page.getByText('Only share with people you know.')).toHaveCount(0);
});

test('a report reaches the server and the reporter is told so', async ({ browser }) => {
  const host = await browser.newContext();
  const guest = await browser.newContext();
  const sharer = await host.newPage();
  const viewer = await guest.newPage();
  failOnConsoleErrors(viewer, consoleErrors);

  const { link } = await startSharing(sharer);
  await viewer.goto(new URL(link).pathname);
  await sharer.getByRole('button', { name: 'Allow' }).click();
  await expect(viewer.locator('video')).toBeVisible();

  // From the sharer's side...
  await sharer.getByRole('button', { name: 'Report a problem' }).click();
  await expect(sharer.getByText('Report received — thank you.')).toBeVisible();

  // ...and independently from the viewer's, in the same session.
  await viewer.getByRole('button', { name: 'Report a problem' }).click();
  await expect(viewer.getByText('Report received — thank you.')).toBeVisible();

  await host.close();
  await guest.close();
});
