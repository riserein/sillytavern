import {defineConfig} from '@playwright/test';
import base from './playwright.creative.config.js';
export default defineConfig({...base,testMatch:'translations.e2e.js',outputDir:'test-results/translations'});
