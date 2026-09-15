import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  use: { baseURL: 'http://127.0.0.1:4173', trace: 'retain-on-failure' },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'] } },
    { name: 'mobile', use: { ...devices['Pixel 7'] } },
  ],
  webServer: [
    {
      command: 'dotnet run --project ../Luma.Server -c Release --no-launch-profile --urls http://127.0.0.1:5080',
      url: 'http://127.0.0.1:5080/api/status',
      env: { Luma__DatabasePath: '.local/browser-tests.db', ASPNETCORE_ENVIRONMENT: 'Production' },
    },
    { command: 'npm run preview -- --host 127.0.0.1 --port 4173', url: 'http://127.0.0.1:4173' },
  ],
})
