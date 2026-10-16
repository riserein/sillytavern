import { defineConfig } from '@playwright/test';

export default defineConfig({
    testDir: './tests',
    testMatch: '*.e2e.js',
    // The independent card suite needs a real, separately installed Tavern Helper.
    testIgnore: '**/card-player.e2e.js',
    workers: 1,
    timeout: 45000,
    use: {
        baseURL: process.env.ST_BASE_URL || 'http://127.0.0.1:8000',
        headless: true,
        launchOptions: {
            ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}),
        },
        screenshot: 'only-on-failure',
        trace: 'retain-on-failure',
    },
});
