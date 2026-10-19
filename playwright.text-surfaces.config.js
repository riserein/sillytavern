import { defineConfig } from '@playwright/test';
import reading from './playwright.reading.config.js';
export default defineConfig({ ...reading, testMatch: 'text-surfaces.e2e.js', outputDir: 'test-results/text-surfaces', timeout: 240000 });
