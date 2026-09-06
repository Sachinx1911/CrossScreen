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
  await expect(sharer.getByText('Nobody is watching yet')).toBeVisible();

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
  await expect(sharer.getByText('Nobody is watching yet')).toBeVisible();

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
