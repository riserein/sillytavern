import { defineConfig } from '@playwright/test';
export default defineConfig({
    testDir: './tests', testMatch: 'reading.e2e.js', workers: 1, timeout: 180000,
    outputDir: 'test-results/reading',
    use: { baseURL: process.env.ST_BASE_URL || 'http://127.0.0.1:8000', browserName: 'chromium', launchOptions: { executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium' }, screenshot: 'only-on-failure', trace: 'retain-on-failure' },
    projects: [{ name: 'desktop', use: { viewport: { width: 1000, height: 900 } } }, { name: 'mobile-chromium-emulation', use: { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 } }],
});
