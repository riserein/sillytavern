import { test, expect } from '@playwright/test';
import { readFile, mkdir } from 'node:fs/promises';
const prefix = '/scripts/extensions/third-party/sillytavern/';
const tone = await readFile(new URL('../card-player/demo-assets/test-tone-a.mp3', import.meta.url));
const tab = (page, name) => page.getByRole('tab', { name, exact: true }).click();
const state = page => page.evaluate(() => SillyTavern.getContext().extensionSettings.riserein_music_player);
test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 1000 });
    await page.route('**/api/settings/get', async route => {
        const response = await route.fetch(), body = await response.json(), data = JSON.parse(body.settings);
        data.firstRun = false; data.main_api = 'kobold'; data.api_server = ''; data.extension_settings ||= {};
        data.extension_settings.riserein_music_player = { tracks: [], theme: 'night', colorScheme: 'dark', surface: 'matte', fontPreset: 'sans', panelSize: { width: 640, height: 700 }, positions: { panel: { x: .2, y: .1 } } };
        body.settings = JSON.stringify(data); await route.fulfill({ response, json: body });
    });
    await page.goto('/'); await expect(page.locator('#stm-launcher')).toBeVisible({ timeout: 30000 });
    await page.waitForFunction(() => !document.getElementById('preloader'));
    await page.evaluate(async () => { await (await import('/script.js')).closeCurrentChat(); });
    await page.unroute('**/api/settings/get'); await page.locator('#stm-launcher').click();
    await tab(page, '导入'); await page.locator('[data-role=files]').setInputFiles(['A', 'B'].map(name => ({ name: name+'.mp3', mimeType: 'audio/mpeg', buffer: tone })));
    await expect(page.locator('.stm-status')).toContainText('已导入 2 首音乐');
});
test('actual host favorites persist, ZIP includes them, batch addition/deletion preserves files and listening', async ({ page }) => {
    test.slow(); await tab(page, '播放'); await page.locator('[data-action=play]').click();
    await expect.poll(() => page.locator('#stm-player audio').evaluate(node => node.currentTime)).toBeGreaterThan(.2);
    await page.evaluate(() => window.savedAudio = document.querySelector('#stm-player audio'));
    await page.locator('.stm-options [data-favorite-id]').click();
    await tab(page, '曲库'); await page.locator('.stm-favorites-entry').click();
    await expect(page.locator('.stm-favorite-list li')).toHaveCount(1); await page.locator('#stm-favorite-search').fill('missing'); await expect(page.locator('.stm-favorite-list li')).toHaveCount(0); await page.locator('#stm-favorite-search').fill('');
    await tab(page, '曲库'); await page.locator('[data-action=new-playlist]').click(); await page.locator('#stm-new-playlist').fill('收藏整理'); await page.getByRole('button', { name: '新建', exact: true }).click();
    await tab(page, '曲库'); await page.locator('.stm-favorites-entry').click(); await page.locator('[data-favorite-all]').check(); await page.locator('[data-favorite-add]').click();
    expect((await state(page)).playlists[0].trackIds.length).toBe(1);
    expect(await page.evaluate(() => savedAudio === document.querySelector('#stm-player audio') && !savedAudio.paused)).toBe(true);
    const zip = await page.evaluate(async prefix => {
        const { createBackup, inspectBackup } = await import(prefix+'data/backup.js'), { LocalMusicStore } = await import(prefix+'local-store.js');
        const backup = await createBackup({ settings: SillyTavern.getContext().extensionSettings.riserein_music_player, store: new LocalMusicStore() });
        const read = await inspectBackup(backup.blob); return {favorites: read.manifest.settings.favorites, bytes:backup.bytes};
    }, prefix); expect(zip.favorites.length).toBe(1); expect(zip.bytes).toBeGreaterThan(tone.length);
    await tab(page, '外观'); const saved=page.waitForResponse(r=>r.url().endsWith('/api/settings/save')&&r.ok()); await page.locator('[data-color=accent]').fill('#aabbcc'); await saved;
    await page.reload();await expect(page.locator('#stm-launcher')).toBeVisible();await page.waitForFunction(()=>!document.getElementById('preloader'));await page.locator('#stm-launcher').click();
    expect((await state(page)).favorites.length).toBe(1);await tab(page,'曲库');await page.locator('.stm-favorites-entry').click();await expect(page.locator('.stm-favorite-list li')).toHaveCount(1);
    await mkdir('docs/v2/listening',{recursive:true});await page.locator('#stm-player').screenshot({path:'docs/v2/listening/favorites-desktop.png'});
    await page.setViewportSize({width:390,height:844});await page.locator('#stm-player').screenshot({path:'docs/v2/listening/favorites-mobile-emulation.png'});
    await page.locator('[data-favorite-home]').click();await page.locator('.stm-collection-open[data-collection-id=""]').click();await page.getByRole('button',{name:'歌曲详情：A',exact:true}).click();
    page.once('dialog',d=>d.accept());await page.locator('[data-action=detail-delete]').click();expect((await state(page)).favorites).toEqual([]);expect((await state(page)).tracks.length).toBe(1);
});
test('actual audio ramps cancel across rapid control changes, keep base volume and one Audio, and sleep ends a track without advancing',async({page})=>{
    await tab(page,'播放');await page.locator('[data-action=play]').click();await expect.poll(()=>page.locator('#stm-player audio').evaluate(a=>a.currentTime)).toBeGreaterThan(.2);
    await page.evaluate(()=>window.savedAudio=document.querySelector('#stm-player audio'));
    await page.locator('#stm-volume').fill('37');await expect.poll(()=>page.locator('#stm-player audio').evaluate(a=>a.volume)).toBeCloseTo(.37);
    const trace=await page.locator('[data-action=play]').evaluate(async button=>{const a=document.querySelector('#stm-player audio');button.click();await new Promise(r=>setTimeout(r,100));const fading=a.volume;button.click();await new Promise(r=>setTimeout(r,400));return {fading,paused:a.paused,volume:a.volume};});
    expect(trace.fading).toBeGreaterThan(0);expect(trace.fading).toBeLessThan(.37);expect(trace.paused).toBe(false);expect(trace.volume).toBe(.37);
    await page.locator('[data-action=next]').evaluate(async button=>{button.click();await new Promise(r=>setTimeout(r,40));button.click();});
    await expect.poll(()=>page.locator('#stm-player audio').evaluate(a=>a.volume)).toBe(.37);expect(await page.evaluate(()=>savedAudio===document.querySelector('#stm-player audio'))).toBe(true);
    expect((await state(page)).volume).toBe(.37);
    // Seek is unavailable during a source transition; an immediate interaction
    // must wait for the new recording instead of seeking the outgoing audio.
    const before=(await state(page)).currentId;await page.locator('[data-action=next]').click();await page.locator('#stm-seek').fill('9');
    expect((await state(page)).currentId).not.toBe(before);await expect.poll(()=>page.locator('#stm-player audio').evaluate(a=>a.currentTime)).toBeGreaterThanOrEqual(9);
    await page.locator('.stm-sleep-button').click();await page.locator('[data-sleep-minutes="15"]').click();await expect(page.locator('[data-sleep-state]')).toContainText('14:');await page.locator('[data-sleep-pause]').click();const paused=await page.locator('[data-sleep-state]').textContent();await page.waitForTimeout(1100);await expect(page.locator('[data-sleep-state]')).toHaveText(paused);await page.locator('[data-sleep-pause]').click();
    await page.getByRole('button',{name:'关闭睡眠定时器',exact:true}).click();await page.locator('[data-action=close]').click();await page.waitForTimeout(1100);await page.locator('#stm-launcher').click();await page.locator('.stm-sleep-button').click();await expect(page.locator('[data-sleep-state]')).toContainText('剩余');
    await page.locator('[data-sleep-track]').click();await page.getByRole('button',{name:'关闭睡眠定时器',exact:true}).click();const current=(await state(page)).currentId;
    await page.locator('#stm-player audio').evaluate(a=>{a.currentTime=a.duration-.15;});await expect.poll(()=>page.locator('#stm-player audio').evaluate(a=>a.ended)).toBe(true);expect((await state(page)).currentId).toBe(current);await expect(page.locator('.stm-sleep-button')).toHaveAttribute('data-active','false');expect((await state(page)).volume).toBe(.37);
});
test('one real minute deadline stops actual MP3 while the panel is closed and restores normal volume',async({page})=>{
    test.setTimeout(100000);
    await tab(page,'播放');await page.locator('[data-action=play]').click();await expect.poll(()=>page.locator('#stm-player audio').evaluate(a=>a.currentTime)).toBeGreaterThan(.2);
    await page.locator('.stm-sleep-button').click();await page.locator('#stm-sleep-minutes').fill('1');
    const started=Date.now();await page.locator('.stm-sleep-custom button').click();await page.getByRole('button',{name:'关闭睡眠定时器',exact:true}).click();await page.locator('[data-action=close]').click();
    await expect.poll(()=>page.locator('#stm-player audio').evaluate(a=>a.paused),{timeout:65000,intervals:[500]}).toBe(true);
    expect(Date.now()-started).toBeGreaterThanOrEqual(59000);expect(Date.now()-started).toBeLessThan(65000);
    expect((await state(page)).volume).toBe(.6);expect(await page.locator('#stm-player audio').evaluate(a=>a.volume)).toBe(.6);await expect(page.locator('.stm-sleep-button')).toHaveAttribute('data-active','false');
});
