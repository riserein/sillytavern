import {chromium,expect} from '@playwright/test';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {fixture} from '../tests/creative-fixture.js';
const directory='docs/creative-upgrade/delivery-gallery';
await mkdir(directory,{recursive:true});
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium'});
const context=await browser.newContext({baseURL:process.env.ST_BASE_URL||'http://127.0.0.1:8000',viewport:{width:1100,height:950}}),page=await context.newPage();
try{
 await fixture(page);await page.evaluate(()=>{document.querySelector('.stm-cover-image').src='/scripts/extensions/third-party/sillytavern/assets/covers/moon.png';});
 await expect.poll(()=>page.locator('.stm-cover-image').evaluate(n=>n.complete&&n.naturalWidth>0)).toBe(true);
 const colors={};for(const mode of ['off','strong']){await page.locator('#stm-cover-colors').evaluate((n,mode)=>{n.value=mode;n.dispatchEvent(new Event('change'));},mode);await expect(page.locator('#stm-player')).toHaveAttribute('data-cover-follow',String(mode!=='off'));colors[mode]=await page.locator('#stm-player').evaluate(n=>getComputedStyle(n).getPropertyValue('--stm-solid'));await page.locator('#stm-player').screenshot({path:`${directory}/cover-${mode}.png`});}
 expect(colors.off).not.toBe(colors.strong);
 await page.locator('.stm-soundscape summary').click();await page.locator('[data-sound-action=library]').click();await page.locator('[data-ambient-files]').setInputFiles({name:'原创合成环境音.mp3',mimeType:'audio/mpeg',buffer:await readFile(new URL('../card-player/demo-assets/test-tone-b.mp3',import.meta.url))});await expect(page.locator('[data-ambient-status]')).toContainText('已保存 1 / 1');await page.locator('[data-ambient-action=close]').click();
 await page.getByRole('tab',{name:'曲库',exact:true}).click();await page.locator('[data-action=music-scenes]').click();const scene=page.locator('.stm-scene-manager');await expect(scene).toBeVisible();const id=await page.evaluate(()=>app.settings.ambientLibrary[0].id);await scene.locator('[data-scene-ambient=id]').evaluate((n,id)=>{n.value=id;n.dispatchEvent(new Event('change'));},id);await scene.locator('[data-scene-ambient=enabled]').check();await scene.locator('[data-scene-ambient=volume]').evaluate(n=>{n.value='25';n.dispatchEvent(new Event('input'));});await scene.locator('.stm-scene-ambient').screenshot({path:`${directory}/scene-soundscape.png`});
 await writeFile(`${directory}/capture.json`,JSON.stringify({source:'real shared player browser fixture, not a full Tavern/Helper acceptance test',browser:browser.version(),colors,originalAudio:await page.evaluate(()=>app.audio===originalAudio)},null,2)+'\n');
 await page.evaluate(()=>app.dispose());expect(await page.evaluate(()=>liveURLs.size)).toBe(0);
}finally{await context.close();await browser.close();}
