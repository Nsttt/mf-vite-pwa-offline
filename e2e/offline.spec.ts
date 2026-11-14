import { expect, test } from '@playwright/test';

const REMOTE_ORIGIN = 'http://localhost:5181';

test('remote keeps working after an offline reload', async ({ page, context }) => {
  const remoteRequests: { url: string; fromSW: boolean; status: number }[] = [];
  page.on('response', (response) => {
    if (response.url().startsWith(REMOTE_ORIGIN)) {
      remoteRequests.push({
        url: response.url(),
        fromSW: response.fromServiceWorker(),
        status: response.status(),
      });
    }
  });

  // 1. First visit, online: remote renders, SW installs, cache warm-up runs.
  await page.goto('/');
  await expect(page.getByTestId('remote-widget')).toBeVisible();
  await expect(page.getByTestId('warm-status')).toContainText('pwaRemote cached');
  await expect(page.getByTestId('warm-status')).not.toContainText('(0/');
  await page.evaluate(() => navigator.serviceWorker.ready);

  // 2. Go offline and reload. Host shell comes from precache, remote from runtime cache.
  remoteRequests.length = 0;
  await context.setOffline(true);
  await page.reload();

  await expect(page.getByTestId('network-status')).toContainText('offline');
  await expect(page.getByTestId('remote-error')).toHaveCount(0);
  await expect(page.getByTestId('remote-widget')).toBeVisible();

  await page.getByTestId('remote-counter').click();
  await expect(page.getByTestId('remote-counter')).toHaveText('count is 1');

  // Lazy chunk that was never requested while online: only available because of the warm-up.
  await page.getByTestId('remote-details-toggle').click();
  await expect(page.getByTestId('remote-details')).toBeVisible();

  expect(remoteRequests.length).toBeGreaterThan(0);
  for (const request of remoteRequests) {
    expect(request, request.url).toMatchObject({ fromSW: true, status: 200 });
  }
});
