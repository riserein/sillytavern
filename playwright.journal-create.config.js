import {defineConfig} from '@playwright/test';
import base from './playwright.creative.config.js';
export default defineConfig({...base,timeout:45000,testMatch:'journal-create.e2e.js',outputDir:'test-results/journal-create'});
