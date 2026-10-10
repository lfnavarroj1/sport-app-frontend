import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright local y de pull request: levanta la build de producción con
 * `ng serve` y la configuración `public/app-config.json` (ambiente `local`).
 *
 * Estas ejecuciones NO son E2E integrados. Los recorridos que dependan del BFF
 * deben usar un simulador derivado del contrato OpenAPI aprobado; la suite
 * contra un ambiente desplegado es `playwright.integrated.config.ts`.
 */
const PORT = 4300;

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env['CI'],
  retries: process.env['CI'] ? 1 : 0,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: `npx ng serve --configuration production --port ${PORT}`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: !process.env['CI'],
    timeout: 180_000,
  },
});
