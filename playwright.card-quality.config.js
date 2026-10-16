import { defineConfig } from '@playwright/test';
import base from './playwright.config.js';
export default defineConfig({
    ...base,
    testMatch: 'card-quality.e2e.js',
    outputDir: 'test-results/quality',
    testIgnore: [],
    timeout: 60000,
});
