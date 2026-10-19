import {test,expect} from '@playwright/test';
import {mkdir} from 'node:fs/promises';
const prefix='/scripts/extensions/third-party/sillytavern/';
async function fixture(page){
 await page.route('**/scene-fixture',r=>r.fulfill({contentType:'text/html',body:`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="${prefix}ui/player.css"><body></body>`}));await page.goto('/scene-fixture');
 await page.evaluate(async prefix=>{
  const {initialize}=await import(prefix+'index.js'),events=new Map();window.liveURLs=new Set();const create=URL.createObjectURL.bind(URL),revoke=URL.revokeObjectURL.bind(URL);URL.createObjectURL=blob=>{const id=create(blob);liveURLs.add(id);return id;};URL.revokeObjectURL=id=>{liveURLs.delete(id);revoke(id);};
  const tracks=['a','b','c'].map(id=>({id,kind:'url',title:'歌曲 '+id,artist:'合成测试音',url:location.origin+prefix+'card-player/demo-assets/test-tone-'+id+'.mp3',lyrics:'[00:00]第一句\n[00:02]第二句'}));
  window.ctx={extensionSettings:{riserein_music_player:{tracks,transitionDuration:0,roleScenes:[{avatar:'A.png',defaultSceneId:'rain',scenes:[{id:'rain',name:'雨夜书房',trackIds:['a','b']},{id:'memory',name:'旧日回忆',trackIds:['b','a']},{id:'morning',name:'平静清晨',trackIds:['c']}]},{avatar:'B.png',scenes:[{id:'other',name:'角色 B',trackIds:['b']}]}],theme:'night',colorScheme:'dark',surface:'glass',fontPreset:'sans',panelSize:{width:600,height:740}}},characters:[{avatar:'A.png',name:'角色 A'},{avatar:'B.png',name:'角色 B'}],characterId:0,eventTypes:{CHAT_CHANGED:'chat'},eventSource:{on(type,fn){if(!events.has(type))events.set(type,new Set());events.get(type).add(fn);},removeListener(type,fn){events.get(type)?.delete(fn);}},saveSettingsDebounced(){window.saved=structuredClone(this.extensionSettings.riserein_music_player);}};
  window.emitSceneChat=()=>{for(const fn of events.get('chat')||[])fn();};window.sceneListenerCount=()=>[...events.values()].reduce((sum,s)=>sum+s.size,0);window.app=initialize({context:ctx,previewRecovery:true});app.setOpen(true);window.originalAudio=app.audio;
 },prefix);
 await expect.poll(()=>page.evaluate(()=>app.getScene()?.id)).toBe('rain');await expect.poll(()=>page.evaluate(()=>Number.isFinite(app.audio.duration))).toBe(true);
}
test('scene switching preserves a shared song, paused intent, role isolation and hidden state on one Audio',async({page},info)=>{
 await fixture(page);expect(await page.evaluate(()=>app.settings.scenePreferences.length)).toBe(0);
 await page.locator('[data-action=play]').click();await expect.poll(()=>page.evaluate(()=>app.audio.currentTime)).toBeGreaterThan(.2);
 const before=await page.evaluate(()=>({src:app.audio.src,time:app.audio.currentTime}));
 await page.locator('[data-scene-open]').click();const pick=page.locator('[data-scene-action=choose][data-id=memory]');if(info.project.name==='desktop')await pick.click();else await pick.tap();
 expect(await page.evaluate(()=>app.audio===originalAudio&&!app.audio.paused)).toBe(true);expect(await page.evaluate(()=>app.audio.src)).toBe(before.src);expect(await page.evaluate(()=>app.audio.currentTime)).toBeGreaterThanOrEqual(before.time);
 await page.evaluate(()=>app.audio.pause());await page.evaluate(()=>app.chooseScene('morning'));expect(await page.evaluate(()=>app.audio.paused)).toBe(true);await expect(page.locator('[data-role=title]')).toHaveText('歌曲 c');
 await page.evaluate(()=>{ctx.characterId=1;emitSceneChat();});await expect.poll(()=>page.evaluate(()=>app.getScene()?.id)).toBe('other');await expect(page.locator('[data-role=title]')).toHaveText('歌曲 b');
 await page.evaluate(()=>{ctx.characterId=0;emitSceneChat();});await expect.poll(()=>page.evaluate(()=>app.getScene()?.id)).toBe('morning');
 await page.evaluate(()=>app.visibility.setState('hidden'));await page.evaluate(()=>app.chooseScene('rain'));expect(await page.evaluate(()=>app.visibility.state)).toBe('hidden');expect(await page.evaluate(()=>app.audio.paused)).toBe(true);
 await page.evaluate(()=>app.visibility.restore());await page.locator('#stm-launcher').click();
 await page.evaluate(()=>{app.settings.transitionDuration=300;});await page.locator('[data-action=play]').click();await expect.poll(()=>page.evaluate(()=>!app.audio.paused)).toBe(true);
 await page.evaluate(()=>Promise.all([app.chooseScene('morning'),app.chooseScene('memory'),app.chooseScene('morning')]));await expect(page.locator('[data-role=title]')).toHaveText('歌曲 c');
 expect(await page.evaluate(()=>app.audio===originalAudio)).toBe(true);expect(await page.locator('audio').count()).toBe(1);
 await page.evaluate(()=>{app.dispose();});expect(await page.evaluate(()=>originalAudio.paused&&liveURLs.size===0&&sceneListenerCount()===0)).toBe(true);
});
test('author edits isolated drafts, orders songs, previews without publishing and survives a quota failure',async({page},info)=>{
 await fixture(page);await page.evaluate(()=>{window.beforeScene=JSON.stringify(app.settings.roleScenes);app.openScenes();});
 const manager=page.locator('.stm-scene-manager');await expect(manager).toBeVisible();await manager.locator('[data-scene-field=name]').fill('修改中的书房');expect(await page.evaluate(()=>JSON.stringify(app.settings.roleScenes))).toBe(await page.evaluate(()=>beforeScene));
 await manager.locator('[data-scene-action=preview]').click();expect(await page.evaluate(()=>JSON.stringify(app.settings.roleScenes))).toBe(await page.evaluate(()=>beforeScene));expect(await page.evaluate(()=>app.settings.scenePreferences.length)).toBe(0);
 await manager.locator('[data-scene-action=track-down][data-id=a]').click();
 await manager.locator('[data-scene-file=coverId]').setInputFiles({name:'cover.png',mimeType:'image/png',buffer:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=','base64')});await expect(manager.locator('[data-scene-resources]')).toContainText('封面：已选择');
 await page.evaluate(async prefix=>{const {LocalMusicStore}=await import(prefix+'local-store.js');window.originalScenePut=LocalMusicStore.prototype.putMany;LocalMusicStore.prototype.putMany=async()=>{throw new DOMException('测试空间不足','QuotaExceededError');};},prefix);
 await manager.locator('[data-scene-action=save]').click();await expect(page.locator('.stm-status')).toContainText('测试空间不足');expect(await page.evaluate(()=>JSON.stringify(app.settings.roleScenes))).toBe(await page.evaluate(()=>beforeScene));
 await page.evaluate(async prefix=>{const {LocalMusicStore}=await import(prefix+'local-store.js');LocalMusicStore.prototype.putMany=originalScenePut;},prefix);await manager.locator('[data-scene-action=save]').click();await expect(manager.locator('[data-scene-save-status]')).toContainText('酒馆保存');
 expect(await page.evaluate(()=>app.settings.roleScenes[0].scenes[0].trackIds)).toEqual(['b','a']);
 await mkdir('docs/music-journal/scenes',{recursive:true});await manager.screenshot({path:`docs/music-journal/scenes/manager-${info.project.name}.png`});
 await manager.locator('[data-scene-action=close]').click();await page.evaluate(async prefix=>{app.dispose();app=(await import(prefix+'index.js')).initialize({context:ctx,previewRecovery:true});app.setOpen(true);},prefix);
 await expect.poll(()=>page.evaluate(()=>app.getScene()?.name)).toBe('修改中的书房');expect(await page.evaluate(()=>app.settings.roleScenes[0].scenes[0].trackIds)).toEqual(['b','a']);await page.evaluate(()=>app.dispose());expect(await page.evaluate(()=>liveURLs.size)).toBe(0);
});
test('journal reuses music controls and lyric DOM across real book pages and every lyric mode',async({page},info)=>{
 await fixture(page);await page.locator('[data-action=play]').click();await expect.poll(()=>page.evaluate(()=>app.audio.currentTime)).toBeGreaterThan(.1);
 await page.evaluate(()=>{window.keptLyricView=document.querySelector('.stm-lyrics-view');window.keptJournalSource=app.audio.src;app.setDesign({layout:'journal'});});
 const mobile=info.project.name!=='desktop',book=page.locator('.stm-journal');await expect(book).toBeVisible();
 if(!mobile){const left=await page.locator('.stm-journal-left').boundingBox(),right=await page.locator('.stm-journal-right').boundingBox();expect(Math.abs(left.y-right.y)).toBeLessThan(2);expect(left.width).toBeGreaterThan(200);expect(right.width).toBeGreaterThan(200);}
 else {await expect(book).toHaveAttribute('data-journal-page','player');await expect(page.locator('.stm-journal-left')).toBeVisible();}
 const turn=async name=>{const b=page.locator(`button[data-journal-page=${name}]`);if(mobile)await b.tap();else await b.click();};
 for(const tab of ['notes','collection','lyrics']){await turn(tab);await expect(book).toHaveAttribute('data-journal-page',tab);expect(await page.evaluate(()=>app.audio===originalAudio&&!app.audio.paused&&app.audio.src===keptJournalSource)).toBe(true);}
 for(const mode of ['flow','centered','immersive']){
  await page.evaluate(mode=>{const select=document.getElementById('stm-lyric-mode');select.value=mode;select.dispatchEvent(new Event('change'));app.audio.currentTime=2.2;app.audio.dispatchEvent(new Event('timeupdate'));},mode);
  await expect(page.locator('.stm-lyrics-view')).toHaveAttribute('data-lyric-mode',mode);expect(await page.evaluate(()=>document.querySelector('.stm-lyrics-view')===keptLyricView&&app.audio===originalAudio)).toBe(true);
 }
 await turn('collection');await page.locator('[data-journal-track=b]').click();await expect(page.locator('[data-role=title]')).toHaveText('歌曲 b');await expect.poll(()=>page.evaluate(()=>!app.audio.paused)).toBe(true);
 await mkdir('docs/music-journal/journal',{recursive:true});await page.locator('#stm-player').screenshot({path:`docs/music-journal/journal/collection-${info.project.name}.png`});
 await page.evaluate(()=>app.setDesign({layout:'vinyl'}));await expect(book).toBeHidden();expect(await page.evaluate(()=>app.audio===originalAudio&&!app.audio.paused&&document.querySelector('.stm-lyrics-view')===keptLyricView)).toBe(true);
 await page.evaluate(()=>app.setDesign({layout:'journal'}));await turn('notes');
 expect(await page.locator('[data-journal-note]').evaluate(n=>getComputedStyle(n).backgroundColor)).toBe('rgba(0, 0, 0, 0)');await page.evaluate(()=>app.dispose());expect(await page.evaluate(()=>originalAudio.paused&&liveURLs.size===0)).toBe(true);
});
test('author song notes render as text, follow the current song and can be hidden without deletion',async({page},info)=>{
 await fixture(page);await page.evaluate(()=>app.openScenes());const manager=page.locator('.stm-scene-manager'),unsafe='<img src=x onerror="window.noteInjected=1">\n只属于歌曲 a 的手记';
 await manager.locator('[data-scene-note-wrap=a] summary').click();await manager.locator('[data-scene-note=a]').fill(unsafe);
 await manager.locator('[data-scene-note-wrap=b] summary').click();await manager.locator('[data-scene-note=b]').fill('歌曲 b：写给旧日的信。');
 await manager.locator('[data-scene-field=description]').fill('窗外下着雨，书房里只有低缓的钢琴声。');await manager.locator('[data-scene-action=save]').click();await expect(manager.locator('[data-scene-save-status]')).toContainText('酒馆保存');
 await mkdir('docs/music-journal/notes',{recursive:true});await manager.screenshot({path:`docs/music-journal/notes/editor-${info.project.name}.png`});await manager.locator('[data-scene-action=close]').click();
 await page.evaluate(()=>app.setDesign({layout:'journal'}));await page.locator('button[data-journal-page=notes]').click();await expect(page.locator('[data-journal-note]')).toHaveText(unsafe);await expect(page.locator('[data-journal-note] img')).toHaveCount(0);expect(await page.evaluate(()=>window.noteInjected)).toBeUndefined();await expect(page.locator('[data-journal-description]')).toContainText('窗外下着雨');
 await page.locator('button[data-journal-page=collection]').click();await page.locator('[data-journal-track=b]').click();await page.locator('button[data-journal-page=notes]').click();await expect(page.locator('[data-journal-note]')).toHaveText('歌曲 b：写给旧日的信。');
 await page.evaluate(()=>app.openScenes());await manager.locator('[data-scene-show-notes]').uncheck();await manager.locator('[data-scene-action=save]').click();await expect(manager.locator('[data-scene-save-status]')).toContainText('酒馆保存');await manager.locator('[data-scene-action=close]').click();await expect(page.locator('[data-journal-note]')).toHaveText('');expect(await page.evaluate(()=>app.settings.roleScenes[0].notes.length)).toBe(2);
 expect(await page.locator('[data-journal-note]').evaluate(n=>getComputedStyle(n).backgroundColor)).toBe('rgba(0, 0, 0, 0)');await page.evaluate(()=>app.dispose());
});
