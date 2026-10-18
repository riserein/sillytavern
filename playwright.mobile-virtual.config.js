import { defineConfig } from '@playwright/test';

// Chromium device profiles exercise real touch input, not the iOS/Android OS.
export default defineConfig({
    testDir: './tests',
    testMatch: 'mobile-virtual.e2e.js',
    outputDir: 'test-results/mobile-virtual',
    workers: 1,
    timeout: 90000,
    use: {
        baseURL: process.env.ST_BASE_URL || 'http://127.0.0.1:8000',
        browserName: 'chromium',
        launchOptions: { executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium' },
        isMobile: true,
        hasTouch: true,
        deviceScaleFactor: 2,
        screenshot: 'only-on-failure',
        trace: 'retain-on-failure',
    },
    projects: [
        { name: 'chromium-small-320', use: { viewport: { width: 320, height: 568 } } },
        { name: 'chromium-iphone-geometry-390', use: { viewport: { width: 390, height: 844 } } },
        { name: 'chromium-android-geometry-412', use: { viewport: { width: 412, height: 915 } } },
    ],
});
