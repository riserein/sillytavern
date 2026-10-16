import { defineConfig } from '@playwright/test';
import base from './playwright.config.js';
export default defineConfig({
    ...base,
    testMatch: 'card-native.e2e.js',
    testIgnore: [],
    timeout: 180000,
});
