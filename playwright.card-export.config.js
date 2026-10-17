import {defineConfig} from '@playwright/test';
import base from './playwright.config.js';
export default defineConfig({...base,testMatch:'card-maker.e2e.js',testIgnore:[],timeout:150000,reporter:[['list'],['json',{outputFile:process.env.PLAYWRIGHT_JSON_OUTPUT_FILE||'docs/card-player/export-playwright.json'}]]});
