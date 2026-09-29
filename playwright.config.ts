import { defineConfig, devices } from '@playwright/test';

/**
 * Два окружения: обычные сценарии гоняем по dev-серверу, а офлайн и
 * service worker — только по собранной версии, иначе проверять нечего.
 *
 * Интерактивные тесты идут в WebKit — на телефоне приложение живёт в Safari.
 * Офлайн-проект вынужденно в Chromium: эмуляция сети в Playwright WebKit
 * падает внутренней ошибкой на reload при активном service worker.
 */
export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  workers: 1,
  reporter: process.env.CI ? 'dot' : 'list',
  use: {
    ...devices['iPhone 13'],
    trace: 'retain-on-failure',
  },
  projects: [
    {
      name: 'app',
      testMatch: /smoke\.spec\.ts/,
      use: { baseURL: 'http://localhost:5181' },
    },
    {
      name: 'pwa',
      testMatch: /offline\.spec\.ts/,
      use: {
        ...devices['Pixel 7'],
        baseURL: 'http://localhost:5182',
      },
    },
  ],
  webServer: [
    {
      command: 'npm run dev -- --port 5181 --strictPort',
      url: 'http://localhost:5181',
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
    },
    {
      command: 'npm run build && npx vite preview --port 5182 --strictPort',
      url: 'http://localhost:5182',
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
  ],
});
