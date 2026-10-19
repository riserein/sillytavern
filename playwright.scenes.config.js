import { defineConfig } from '@playwright/test';
import reading from './playwright.reading.config.js';
export default defineConfig({...reading,testMatch:'music-scenes.e2e.js',outputDir:'test-results/scenes',timeout:120000});
