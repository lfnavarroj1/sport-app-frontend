import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright integrado: se ejecuta contra una aplicación ya desplegada
 * (development o staging). Requiere `PLAYWRIGHT_BASE_URL`; sin ella falla en
 * lugar de probar contra un servidor local por error. Excluye los recorridos
 * `@simulado`, que reemplazan el BFF con el simulador del contrato.
 */
const baseURL = process.env['PLAYWRIGHT_BASE_URL'];
if (!baseURL) {
  throw new Error(
    'PLAYWRIGHT_BASE_URL es obligatoria para la suite integrada (URL del ambiente desplegado).',
  );
}

export default defineConfig({
  testDir: './e2e',
  grepInvert: /@simulado/,
  fullyParallel: true,
  forbidOnly: true,
  retries: 1,
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'playwright-report-integrated' }]],
  use: {
    baseURL,
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
