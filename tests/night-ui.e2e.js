import {test,expect} from '@playwright/test';

function tone() {
    const rate=8000,samples=rate*45,buffer=Buffer.alloc(44+samples*2);
    buffer.write('RIFF');buffer.writeUInt32LE(buffer.length-8,4);buffer.write('WAVEfmt ',8);buffer.writeUInt32LE(16,16);buffer.writeUInt16LE(1,20);buffer.writeUInt16LE(1,22);buffer.writeUInt32LE(rate,24);buffer.writeUInt32LE(rate*2,28);buffer.writeUInt16LE(2,32);buffer.writeUInt16LE(16,34);buffer.write('data',36);buffer.writeUInt32LE(samples*2,40);
    for(let n=0;n<samples;n++)buffer.writeInt16LE(Math.round(Math.sin(n*2*Math.PI*220/rate)*600),44+n*2);
    return buffer;
}
const tab=(page,name)=>page.getByRole('tab',{name,exact:true}).click();
async function menu(page,id,value){const text=await page.locator(id).evaluate((select,value)=>[...select.options].find(option=>option.value===value).textContent,value);await page.locator(id+'-trigger').click();await page.locator(id+'-menu').getByRole('option',{name:text,exact:true}).click();}
async function importTracks(page,names=['雨落旧书页','海岸来信','未寄出的晚风']){await tab(page,'导入');await page.locator('[data-role=files]').setInputFiles(names.map(name=>({name:name+'.wav',mimeType:'audio/wav',buffer:tone()})));await expect(page.locator('.stm-status')).toContainText(`已导入 ${names.length} 首音乐`);}
async function collection(page,id=''){await tab(page,'曲库');await page.locator(`.stm-collection-open[data-collection-id="${id}"]`).click();}
async function createList(page,name){await tab(page,'曲库');await page.locator('[data-action=new-playlist]').click();await page.locator('#stm-new-playlist').fill(name);await page.getByRole('button',{name:'新建',exact:true}).click();return page.locator('#stm-library-playlist').inputValue();}
const settings=page=>page.evaluate(()=>SillyTavern.getContext().extensionSettings.riserein_music_player);
async function shot(page,name){await expect(page.locator('.stm-status')).toHaveText('',{timeout:8500});await page.locator('#stm-player').evaluate(panel=>panel.querySelector(':focus')?.blur());await page.mouse.move(0,0);await page.locator('#stm-player').screenshot({path:`docs/night-ui-${name}.png`,animations:'disabled'});}

test.beforeEach(async({page})=>{
    await page.setViewportSize({width:1280,height:1000});
    await page.route('**/api/settings/get',async route=>{const response=await route.fetch(),body=await response.json(),data=JSON.parse(body.settings);data.firstRun=false;data.main_api="kobold";data.api_server="";data.extension_settings||={};data.extension_settings.riserein_music_player={tracks:[],theme:'night',colorScheme:'dark',surface:'matte',fontPreset:'sans',panelSize:{width:640,height:700},positions:{panel:{x:.2,y:.1}}};body.settings=JSON.stringify(data);await route.fulfill({response,json:body});});
    await page.goto('/');await expect(page.locator('#stm-launcher')).toBeVisible({timeout:30000});await page.waitForFunction(()=>!document.getElementById('preloader'));
    await page.evaluate(async()=>{const {closeCurrentChat}=await import('/script.js');await closeCurrentChat();});await page.unroute('**/api/settings/get');await page.locator('#stm-launcher').click();
});

test('B queue edits change listening order without editing permanent collections, and reload restores the collection',async({page})=>{
    await importTracks(page);await collection(page);await page.getByRole('button',{name:'播放歌曲：雨落旧书页',exact:true}).click();
    await expect.poll(()=>page.locator('#stm-player audio').evaluate(audio=>audio.currentTime)).toBeGreaterThan(.2);
    const ids=(await settings(page)).tracks.map(track=>track.id);
    await page.locator('.stm-mini-queue').click();await page.getByRole('button',{name:'移出播放队列：海岸来信',exact:true}).click();
    await page.getByRole('button',{name:'上移队列歌曲：未寄出的晚风',exact:true}).click();
    await expect(page.locator('.stm-queue-track')).toHaveCount(2);await expect(page.locator('.stm-queue-track').first().locator('.stm-song-title')).toHaveText('未寄出的晚风');
    expect((await settings(page)).tracks.map(track=>track.id)).toEqual(ids);
    await expect(page.getByRole('button',{name:'移出播放队列：雨落旧书页',exact:true})).toBeDisabled();
    await shot(page,'queue');await page.getByRole('button',{name:'关闭播放列表',exact:true}).click();await tab(page,'播放');await page.locator('[data-action=next]').click();
    await expect(page.locator('[data-role=title]')).toHaveText('未寄出的晚风');
    await page.locator('[data-action=toggle-queue]').click();await page.locator('[data-action=reset-queue]').click();await expect(page.locator('.stm-queue-track')).toHaveCount(3);
    await page.getByRole('button',{name:'关闭播放列表',exact:true}).click();await tab(page,'外观');
    const saved=page.waitForResponse(response=>response.url().endsWith('/api/settings/save')&&response.ok());await page.locator('[data-color=accent]').fill('#aabbcc');await saved;
    await page.reload();await page.waitForFunction(()=>!document.getElementById('preloader'));await page.locator('#stm-launcher').click();await page.locator('[data-action=toggle-queue]').click();
    await expect(page.locator('.stm-queue-track')).toHaveCount(3);expect((await settings(page)).tracks.map(track=>track.id)).toEqual(ids);expect(await page.locator('#stm-player audio').evaluate(audio=>audio.paused)).toBe(true);
});

test('B browsing keeps audio playing; library search, batch memberships, descriptions and saved order work together',async({page})=>{
    test.slow();await importTracks(page);await collection(page);await page.getByRole('button',{name:'播放歌曲：雨落旧书页',exact:true}).click();
    await expect.poll(()=>page.locator('#stm-player audio').evaluate(audio=>audio.currentTime)).toBeGreaterThan(.2);
    const source=await page.locator('#stm-player audio').getAttribute('src'),id=await createList(page,'雨夜与旧书');
    expect(await page.locator('#stm-player audio').evaluate(audio=>audio.paused)).toBe(false);expect((await settings(page)).activePlaylistId).toBe(null);
    await collection(page);await page.locator('#stm-library-search').fill('海岸');await expect(page.locator('.stm-track')).toHaveCount(1);await page.locator('#stm-library-search').fill('');
    await menu(page,'#stm-library-filter','local');await menu(page,'#stm-library-sort','title');await expect(page.locator('.stm-track')).toHaveCount(3);
    await page.locator('[data-action=toggle-bulk]').click();await page.getByRole('checkbox',{name:'选择歌曲：雨落旧书页',exact:true}).check();await page.getByRole('checkbox',{name:'选择歌曲：海岸来信',exact:true}).check();await menu(page,'#stm-bulk-target',id);await page.locator('[data-action=bulk-add]').click();
    expect((await settings(page)).playlists[0].trackIds.length).toBe(2);await page.locator('[data-action=toggle-bulk]').click();await collection(page,id);
    expect(await page.locator('#stm-player audio').getAttribute('src')).toBe(source);expect(await page.locator('#stm-player audio').evaluate(audio=>audio.paused)).toBe(false);
    await page.locator('[data-action=toggle-manager]').click();await page.locator('#stm-playlist-description').fill('雨声、灯火，还有那些缓缓展开的故事。');await page.locator('[data-action=save-description]').click();
    await page.locator('[data-action=edit-order]').click();await page.getByRole('button',{name:'下移歌曲：雨落旧书页',exact:true}).click();
    await expect(page.locator('.stm-track-title')).toHaveText(['海岸来信','雨落旧书页']);
    await page.locator('[data-action=edit-order]').click();await page.locator('[data-action=toggle-manager]').click();await shot(page,'playlist');
    await tab(page,'曲库');await shot(page,'library');await tab(page,'播放');await page.locator('[data-action=toggle-queue]').click();await expect(page.locator('.stm-queue-track')).toHaveCount(3);
    await page.getByRole('button',{name:'关闭播放列表',exact:true}).click();
    const saved=page.waitForResponse(response=>response.url().endsWith('/api/settings/save')&&response.ok());await tab(page,'外观');await page.locator('[data-color=accent]').fill('#b2c3b1');await saved;
    await page.reload();await page.waitForFunction(()=>!document.getElementById('preloader'));await page.locator('#stm-launcher').click();await collection(page,id);
    await expect(page.locator('[data-role=hero-description]')).toHaveText('雨声、灯火，还有那些缓缓展开的故事。');await expect(page.locator('.stm-track-title')).toHaveText(['海岸来信','雨落旧书页']);
    expect((await settings(page)).tracks.length).toBe(3);
    await page.locator('[data-action=toggle-bulk]').click();await page.getByRole('checkbox',{name:'选择歌曲：海岸来信',exact:true}).check();await page.locator('[data-action=bulk-unlink]').click();await expect(page.locator('.stm-track')).toHaveCount(1);expect((await settings(page)).tracks.length).toBe(3);
});

test('B layout responds to the floating container, keeps mobile controls visible and respects real waiting and reduced motion',async({page})=>{
    test.slow();const errors=[];page.on('pageerror',error=>errors.push(error.message));await importTracks(page);
    await tab(page,'播放');await expect(page.locator('#stm-player')).toHaveAttribute('data-width','wide');await shot(page,'player');
    await collection(page);await page.getByRole('button',{name:'歌曲详情：雨落旧书页',exact:true}).click();await page.locator('[data-action=song-lyrics]').click();await page.locator('[data-role=lyrics-file]').setInputFiles({name:'雨.lrc',mimeType:'text/plain',buffer:Buffer.from('[00:00]把喧嚣留在窗外\n[00:06]听雨落进旧书页\n[00:12]让旋律慢慢写下来')});
    await shot(page,'details');await page.getByRole('button',{name:'关闭歌曲详情',exact:true}).click();await tab(page,'播放');await page.locator('[data-action=toggle-lyrics]').click();await shot(page,'lyrics');await page.getByRole('button',{name:'显示封面',exact:true}).click();
    const resize=page.locator('.stm-resize-handle');for(let n=0;n<6;n++)await resize.press('Shift+ArrowLeft');await expect(page.locator('#stm-player')).toHaveAttribute('data-width','narrow');await shot(page,'compact');
    await page.setViewportSize({width:375,height:844});await expect.poll(async()=>(await page.locator('#stm-player').boundingBox()).width).toBeLessThanOrEqual(351);
    const root=await page.locator('#stm-player').boundingBox(),play=await page.locator('[data-action=play]').boundingBox(),seek=await page.locator('#stm-seek').boundingBox();expect(play.y+play.height).toBeLessThan(root.y+root.height);expect(seek.y+seek.height).toBeLessThan(root.y+root.height);await shot(page,'mobile');
    await page.locator('[data-action=play]').click();await expect(page.locator('#stm-player')).toHaveAttribute('data-audio-state','playing');
    await page.locator('#stm-player audio').evaluate(audio=>audio.dispatchEvent(new Event('stalled')));await expect(page.locator('#stm-player')).toHaveAttribute('data-audio-state','playing');
    await page.locator('#stm-player audio').evaluate(audio=>audio.dispatchEvent(new Event('waiting')));await expect(page.locator('#stm-player')).toHaveAttribute('data-audio-state','loading');
    expect(await page.locator('.stm-mini-disc').evaluate(element=>getComputedStyle(element).animationPlayState)).toBe('paused');
    await page.locator('#stm-player audio').evaluate(audio=>audio.dispatchEvent(new Event('playing')));await tab(page,'最近播放');await page.locator('.stm-mini-play').click();await expect(page.locator('#stm-player')).toHaveAttribute('data-audio-state','paused');
    await page.emulateMedia({reducedMotion:'reduce'});expect(await page.locator('.stm-mini-disc').evaluate(element=>getComputedStyle(element).animationName)).toBe('none');expect(errors).toEqual([]);
});
