import { defineConfig } from '@playwright/test';

// Both apps are built and served with `vite preview`: service workers are not
// meaningful against the dev server.
export default defineConfig({
  testDir: 'e2e',
  timeout: 60 * 1000,
  retries: process.env.CI ? 2 : 0,
  forbidOnly: Boolean(process.env.CI),
  webServer: [
    {
      command: 'pnpm --filter pwa-remote run preview',
      url: 'http://localhost:5181/mf-manifest.json',
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
    {
      command: 'pnpm --filter pwa-host run preview',
      url: 'http://localhost:5180',
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
  ],
  use: {
    baseURL: 'http://localhost:5180',
    browserName: 'chromium',
    serviceWorkers: 'allow',
    // Optional escape hatch for machines where the pinned browser is not installed.
    launchOptions: process.env.PW_CHROMIUM_PATH
      ? { executablePath: process.env.PW_CHROMIUM_PATH }
      : undefined,
    trace: 'retain-on-failure',
  },
  outputDir: 'reports/e2e/output',
  reporter: [['list']],
});
