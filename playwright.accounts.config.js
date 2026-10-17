import {defineConfig} from '@playwright/test';
import base from './playwright.config.js';
export default defineConfig({...base,testMatch:'card-accounts.e2e.js',testIgnore:[],outputDir:'test-results/accounts',timeout:90000,use:{...base.use,baseURL:'http://127.0.0.1:8133'},reporter:[['list'],['json',{outputFile:'docs/v1.13.3/accounts-browser.json'}]]});
