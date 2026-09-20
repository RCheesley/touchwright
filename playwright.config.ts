import { defineConfig, devices } from '@playwright/test';

const PORT = 4173;

/**
 * Point the suite at an already-deployed site to smoke-test it:
 *
 *   E2E_BASE_URL=https://rcheesley.github.io/touchwright/ npx playwright test
 *
 * When this is set no local server is started, so the tests run against exactly
 * what is published, base path and all.
 */
// Normalised to end in a slash so that a relative goto('./') keeps the base path.
const DEPLOYED = process.env.E2E_BASE_URL?.replace(/\/?$/, '/');

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: DEPLOYED ?? `http://localhost:${PORT}`,
    trace: 'on-first-retry',
  },
  // Both themes are first-class: every view is checked in each.
  projects: [
    {
      name: 'light',
      use: { ...devices['Desktop Chrome'], colorScheme: 'light' },
    },
    {
      name: 'dark',
      use: { ...devices['Desktop Chrome'], colorScheme: 'dark' },
    },
  ],
  ...(DEPLOYED === undefined
    ? {
        webServer: {
          // Invoke vite directly: passing flags through `npm run preview --` is fragile.
          command: `npm run build && npx vite preview --port ${PORT} --strictPort`,
          port: PORT,
          reuseExistingServer: !process.env.CI,
          timeout: 120_000,
        },
      }
    : {}),
});
