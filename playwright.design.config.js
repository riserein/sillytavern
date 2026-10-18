import { defineConfig } from '@playwright/test';
import base from './playwright.config.js';
export default defineConfig({ ...base, testMatch:'ui-design.e2e.js',testIgnore:[],outputDir:'test-results/design',timeout:45000 });
