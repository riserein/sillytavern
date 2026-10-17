import {defineConfig} from '@playwright/test';
import base from './playwright.config.js';
export default defineConfig({...base,testMatch:'card-data.e2e.js',testIgnore:[],outputDir:'test-results/data',timeout:90000,reporter:[['list'],['json',{outputFile:process.env.ST_DATA_REPORT||'docs/v1.13.3/data-browser.json'}]]});
