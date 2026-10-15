import {chromium,expect} from '@playwright/test';
import {dirname,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import { writeFile } from 'node:fs/promises';
const browser=await chromium.launch({headless:true,...(process.env.CHROMIUM_PATH ? {executablePath:process.env.CHROMIUM_PATH} : {})});
const root=dirname(fileURLToPath(import.meta.url))+'/', url=(process.env.ST_BASE_URL || 'http://127.0.0.1:8000')+'/scripts/extensions/third-party/sillytavern/design/ui-review/concepts.html';
const results=[];
await writeFile(root+'preview-validation.json',JSON.stringify({status:'running',date:new Date().toISOString(),results:[]}));
try {
 for(const direction of ['a','b']) {
  const page=await browser.newPage({viewport:{width:1280,height:1000},deviceScaleFactor:1});const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(`${url}?direction=${direction}`);await page.waitForFunction(()=>window.__previewReady);
  const shot=async name=>{await page.locator('#stm-player').evaluate(el=>{el.querySelector(':focus')?.blur();});await page.mouse.move(0,0);await page.locator('#stm-player').screenshot({path:root+`${direction}-${name}.png`,animations:'disabled'});};
  await shot('playback');
  await page.getByRole('tab',{name:'曲库',exact:true}).click();await shot('library');
  await page.getByRole('button',{name:'打开歌单：雨夜与旧书',exact:true}).click();await shot('playlist');
  await page.getByRole('tab',{name:'导入',exact:true}).click();await page.getByRole('tab',{name:'在线搜索',exact:true}).click();await shot('search');
  await page.getByRole('tab',{name:'播放',exact:true}).click();await page.getByRole('button',{name:'显示歌词',exact:true}).click();await shot('lyrics');await page.getByRole('button',{name:'显示封面',exact:true}).click();
  await page.locator('#preview-size').selectOption('390,660');await shot('compact');
  await page.getByRole('tab',{name:'曲库',exact:true}).click();await shot('mini');
  await page.getByRole('button',{name:'打开歌单：总曲库',exact:true}).click();await page.locator('#ux-library-search').fill('海岸');await expect(page.locator('.stm-track:visible')).toHaveCount(1);await page.locator('#ux-library-search').fill('');await page.locator('.ux-filter-line input').check();await expect(page.locator('.stm-track:visible')).toHaveCount(5);await page.locator('.ux-filter-line input').uncheck();
  await page.getByRole('button',{name:'歌曲详情：海岸来信',exact:true}).click();await page.locator('[data-ux-detail=membership]').click();await expect(page.locator('.stm-membership')).toBeVisible();await page.locator('[data-action=confirm-membership]').click();await expect.poll(()=>page.evaluate(()=>__previewContext.extensionSettings.riserein_music_player.playlists[0].trackIds.includes('preview-1'))).toBe(true);
  await page.setViewportSize({width:375,height:844});await page.locator('#preview-size').selectOption('351,640');await page.getByRole('tab',{name:'播放',exact:true}).click();await expect(page.locator('.stm-status')).toHaveText('',{timeout:6000});await shot('mobile');
  const box=await page.locator('#stm-player').boundingBox();expect(box.x).toBeGreaterThanOrEqual(0);expect(box.x+box.width).toBeLessThanOrEqual(375);expect(box.y+box.height).toBeLessThanOrEqual(844);
  await page.locator('[data-action=play]').click();await expect.poll(()=>page.locator('audio').evaluate(a=>a.currentTime)).toBeGreaterThan(.2);
  await page.getByRole('tab',{name:'最近播放',exact:true}).click();expect(await page.locator('audio').evaluate(a=>a.paused)).toBe(false);
  expect(await page.locator('.stm-mini-disc').evaluate(el=>getComputedStyle(el).animationPlayState)).toBe('running');
  await page.locator('.stm-mini-play').click();
  await expect.poll(()=>page.locator('.stm-mini-disc').evaluate(el=>getComputedStyle(el).animationPlayState)).toBe('paused');
  // Allow the compositor to commit the pause before measuring its retained rotation.
  await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
  const stoppedAngle=await page.locator('.stm-mini-disc').evaluate(el=>getComputedStyle(el).transform);await page.waitForTimeout(180);
  expect(await page.locator('.stm-mini-disc').evaluate(el=>getComputedStyle(el).transform)).toBe(stoppedAngle);
  await page.locator('.stm-mini-play').click();
  await page.locator('#preview-role').selectOption('0');await expect(page.locator('#stm-playlist')).toHaveValue('preview-night');expect(await page.locator('audio').evaluate(a=>a.paused)).toBe(true);
  await page.locator('[data-action=play]').click();await expect.poll(()=>page.locator('audio').evaluate(a=>a.paused)).toBe(false);
  await page.locator('#preview-role').selectOption('');await expect.poll(()=>page.locator('audio').evaluate(a=>a.paused)).toBe(true);
  await page.getByRole('button',{name:'关闭播放器',exact:true}).click();await page.locator('#stm-launcher').screenshot({path:root+`${direction}-collapsed.png`});await page.locator('#stm-launcher').click();
  await page.emulateMedia({reducedMotion:'reduce'});expect(await page.locator('.ux-launch-disc').evaluate(el=>getComputedStyle(el).animationName)).toBe('none');
  expect(errors).toEqual([]);
  results.push({direction,errors,mobileBounds:box,nativePlayback:true,pageSwitchPreservesAudio:true,roleSwitchPauses:true,homePauses:true,librarySearch:true,sourceFilter:true,membershipFromDetails:true,vinylPauseKeepsAngle:true,reducedMotion:true});await page.close();
 }
 await writeFile(root+'preview-validation.json',JSON.stringify({status:'passed',date:new Date().toISOString(),sourceRevision:'99fb474',results},null,2));console.log(JSON.stringify(results));
}catch(error){await writeFile(root+'preview-validation.json',JSON.stringify({status:'failed',date:new Date().toISOString(),error:error.message,results},null,2));throw error;}finally{await browser.close();}
