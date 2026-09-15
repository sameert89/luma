import { defineConfig, devices } from '@playwright/test'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const webDirectory = path.dirname(fileURLToPath(import.meta.url))
const fixtureDirectory = path.resolve(webDirectory, '../../.local/browser-fixture-v2')

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
      command: 'dotnet run --project ../Luma.Server -c Release --no-launch-profile --urls http://127.0.0.1:5180',
      url: 'http://127.0.0.1:5180/api/status',
      env: {
        ASPNETCORE_ENVIRONMENT: 'Production',
        Luma__DatabasePath: path.join(fixtureDirectory, 'fixture.db'),
        Luma__Indexing__CachePath: path.join(fixtureDirectory, 'cache'),
        Luma__Indexing__Libraries__0__Id: '1',
        Luma__Indexing__Libraries__0__Name: 'Sample library',
        Luma__Indexing__Libraries__0__Path: path.join(fixtureDirectory, 'media'),
        Luma__Indexing__Libraries__0__CaseSensitive: 'true',
        Luma__Indexing__Libraries__0__ScanOnStartup: 'false',
      },
    },
    { command: 'npm run preview -- --host 127.0.0.1 --port 4173', url: 'http://127.0.0.1:4173', env: { LUMA_API_URL: 'http://127.0.0.1:5180' } },
  ],
})
