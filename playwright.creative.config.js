import {defineConfig} from '@playwright/test';
import base from './playwright.reading.config.js';
export default defineConfig({...base,testMatch:'creative.e2e.js',outputDir:'test-results/creative',projects:[{name:'desktop',use:{viewport:{width:1100,height:950}}},...[320,390,412].map(width=>({name:'mobile-'+width,use:{viewport:{width,height:880},hasTouch:true,isMobile:true,deviceScaleFactor:1}}))]});
