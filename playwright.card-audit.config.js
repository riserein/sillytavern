import { defineConfig } from '@playwright/test';
import base from './playwright.config.js';
export default defineConfig({ ...base, testMatch: 'card-audit.e2e.js', testIgnore: [], outputDir: 'test-results/audit', timeout: 90000, reporter: [['list'], ['json', { outputFile: process.env.ST_AUDIT_REPORT || 'docs/card-player/audit-browser-playwright.json' }]] });
