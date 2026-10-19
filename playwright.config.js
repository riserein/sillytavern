import { defineConfig } from '@playwright/test';

export default defineConfig({
    testDir: './tests',
    // Independent suites must not erase each other's trace recordings.
    outputDir: 'test-results/full',
    testMatch: '*.e2e.js',
    // Card tests need Tavern Helper; virtual-mobile tests need touch projects.
    testIgnore: ['**/card-*.e2e.js', '**/mobile-virtual.e2e.js', '**/reading.e2e.js', '**/lyrics-modes.e2e.js'],
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
