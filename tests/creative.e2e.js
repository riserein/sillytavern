const evidence=process.env.ST_CREATIVE_EVIDENCE||'docs/creative-upgrade';
import {test,expect} from '@playwright/test';
import {mkdir} from 'node:fs/promises';
import {fixture} from './creative-fixture.js';
const prefix='/scripts/extensions/third-party/sillytavern/';
test('dragging, one-scene roles and complete hiding cannot accidentally open quick scenes',async({page})=>{
 await fixture(page);await page.evaluate(()=>app.setOpen(false));const launcher=page.locator('#stm-launcher'),box=await launcher.boundingBox();
 await launcher.dispatchEvent('pointerdown',{pointerId:7,pointerType:'touch',clientX:box.x+10,clientY:box.y+10,button:0});await launcher.dispatchEvent('pointermove',{pointerId:7,pointerType:'touch',clientX:box.x+30,clientY:box.y+10,button:0});await page.waitForTimeout(650);await launcher.dispatchEvent('pointerup',{pointerId:7,pointerType:'touch'});await expect(page.locator('.stm-scene-quick')).toBeHidden();
 await page.evaluate(()=>{ctx.characterId=1;emitSceneChat();});await expect.poll(()=>page.evaluate(()=>app.getScene()?.id)).toBe('other');
 expect(await launcher.evaluate(n=>{const e=new MouseEvent('contextmenu',{bubbles:true,cancelable:true});n.dispatchEvent(e);return e.defaultPrevented;})).toBe(false);await expect(page.locator('.stm-scene-quick')).toBeHidden();
 await page.evaluate(()=>{ctx.characterId=0;emitSceneChat();});await expect.poll(()=>page.evaluate(()=>app.getScene()?.id)).toBe('rain');await page.evaluate(()=>app.visibility.setState('hidden'));await expect(launcher).toBeHidden();await launcher.dispatchEvent('contextmenu');await expect(page.locator('.stm-scene-quick')).toBeHidden();await expect(page.locator('#stm-player')).toBeHidden();
 await page.evaluate(()=>app.visibility.restore());expect(await page.evaluate(()=>app.audio.paused)).toBe(true);await page.evaluate(()=>app.dispose());expect(await page.locator('.stm-scene-quick').count()).toBe(0);expect(await page.evaluate(()=>liveURLs.size)).toBe(0);
});
test('cover palettes work in every layout and explicit scene and author colors keep precedence',async({page},info)=>{
 await fixture(page);await page.evaluate(()=>{const c=document.createElement('canvas');c.width=c.height=8;const x=c.getContext('2d');x.fillStyle='#c46630';x.fillRect(0,0,8,8);document.querySelector('.stm-cover-image').src=c.toDataURL();});
 await expect.poll(()=>page.locator('.stm-cover-image').evaluate(n=>n.complete&&n.naturalWidth>0)).toBe(true);
 await mkdir(evidence+'/layout-colors',{recursive:true});
 for(const layout of ['night','crystal','vinyl','cassette','pure','journal'])for(const scheme of ['light','dark']){
  const record=await page.evaluate(async({layout,scheme,prefix})=>{app.setDesign({layout});document.querySelector('[data-scheme-choice='+scheme+']').click();const mode=document.querySelector('#stm-cover-colors');mode.value='strong';mode.dispatchEvent(new Event('change'));const panel=document.querySelector('#stm-player'),css=getComputedStyle(panel),{contrastRatio}=await import(prefix+'ui/contrast.js');return {colors:panel.dataset.designColors,contrast:contrastRatio(css.getPropertyValue('--read-body').trim(),css.getPropertyValue('--read-surface').trim()),sameAudio:app.audio===originalAudio};},{layout,scheme,prefix});
  expect(record.colors).toBe('true');expect(record.contrast).toBeGreaterThanOrEqual(4.5);expect(record.sameAudio).toBe(true);
  if(info.project.name==='desktop')await page.locator('#stm-player').screenshot({path:`${evidence}/layout-colors/${layout}-${scheme}.png`});
 }
 await page.evaluate(()=>app.setDesign({layout:'crystal',customization:{colors:{background:'#16443a',text:'#fffdf2',accent:'#ffd088'}}}));
 expect(await page.locator('#stm-player').evaluate(n=>getComputedStyle(n).getPropertyValue('--design-background').trim())).toBe('#16443a');
 await page.evaluate(async()=>{app.settings.roleScenes[0].scenes[0].themeId='cream';await app.chooseScene('rain');});
 const before=await page.locator('#stm-player').evaluate(n=>getComputedStyle(n).getPropertyValue('--design-surface'));
 await page.evaluate(()=>{const mode=document.querySelector('#stm-cover-colors');mode.value='off';mode.dispatchEvent(new Event('change'));});expect(await page.locator('#stm-player').evaluate(n=>getComputedStyle(n).getPropertyValue('--design-surface'))).toBe(before);await page.evaluate(()=>app.dispose());expect(await page.evaluate(()=>liveURLs.size)).toBe(0);
});
test('incomplete TXT stays a draft and concurrent lyric changes are never overwritten',async({page})=>{
 await fixture(page);page.on('dialog',d=>d.accept());const original=await page.evaluate(()=>app.settings.tracks[0].lyrics);
 await page.getByRole('tab',{name:'曲库',exact:true}).click();await page.locator('[data-collection-id=""]').click();await page.locator('[data-details-id=a]').click();await page.locator('[data-action=edit-lyric-axis]').click();
 const editor=page.locator('#stm-lyric-editor');await editor.locator('[data-axis-file]').setInputFiles({name:'待打点.txt',mimeType:'text/plain',buffer:Buffer.from('第一句原文\n第二句原文')});
 await editor.locator('[data-axis=save]').click();await expect(editor.locator('[data-axis-issues]')).toContainText('请先处理');expect(await page.evaluate(()=>app.settings.tracks[0].lyrics)).toBe(original);
 await editor.locator('[data-axis-time="0"]').fill('00:00.500');await editor.locator('[data-axis-time="0"]').press('Tab');await editor.locator('[data-axis-time="1"]').fill('bad');await editor.locator('[data-axis-time="1"]').press('Tab');
 await editor.locator('[data-axis=save]').click();expect(await page.evaluate(()=>app.settings.tracks[0].lyrics)).toBe(original);
 await editor.locator('[data-axis-time="1"]').fill('00:02.500');await editor.locator('[data-axis-time="1"]').press('Tab');await page.evaluate(()=>app.settings.tracks[0].lyrics='[00:00]另一个操作已保存');
 await editor.locator('[data-axis=save]').click();await expect(editor.locator('[data-axis-issues]')).toContainText('正式歌词已改变');expect(await page.evaluate(()=>app.settings.tracks[0].lyrics)).toBe('[00:00]另一个操作已保存');
 await page.evaluate(()=>{ctx.characterId=1;emitSceneChat();});await expect(editor).toBeHidden();await expect.poll(()=>page.evaluate(()=>app.getScene().id)).toBe('other');expect(await page.evaluate(()=>app.audio===originalAudio)).toBe(true);await page.evaluate(()=>app.dispose());expect(await page.evaluate(()=>liveURLs.size)).toBe(0);
});
test('timeline shares the playing Audio, cancels drafts and saves exact metadata with undo',async({page},info)=>{
 await fixture(page);page.on('dialog',d=>d.accept());await page.locator('[data-action=play]').click();await expect.poll(()=>page.evaluate(()=>app.audio.currentTime)).toBeGreaterThan(.1);
 await page.evaluate(()=>{app.settings.tracks[0].lyrics='[ti:原始标题]\n[offset:100]\n[00:00.20]第一句\n[00:02.00]第二句';app.settings.lyricOffsets.a=100;});
 await page.getByRole('tab',{name:'曲库',exact:true}).click();await page.locator('[data-collection-id=""]').click();await page.locator('[data-details-id=a]').click();
 await page.locator('[data-action=edit-lyric-axis]').click();const editor=page.locator('#stm-lyric-editor');await expect(editor).toBeVisible();
 expect(await page.evaluate(()=>app.audio===originalAudio&&!app.audio.paused)).toBe(true);
 await editor.locator('[data-axis-time="0"]').fill('00:00.400');await editor.locator('[data-axis-time="0"]').press('Tab');await editor.locator('[data-axis=undo]').click();await expect(editor.locator('[data-axis-time="0"]')).toHaveValue('00:00.200');await editor.locator('[data-axis=redo]').click();await editor.locator('[data-axis=save]').click();
 expect(await page.evaluate(()=>app.settings.tracks[0].lyrics)).toContain('[00:00.400]第一句');expect(await page.evaluate(()=>app.settings.tracks[0].lyricOriginal)).toContain('[ti:原始标题]');
 await editor.locator('[data-axis-time="0"]').fill('00:00.600');await editor.locator('[data-axis-time="0"]').press('Tab');await editor.locator('[data-axis=close]').click();expect(await page.evaluate(()=>app.settings.tracks[0].lyrics)).toContain('[00:00.400]第一句');
 await page.locator('[data-action=edit-lyric-axis]').evaluate(b=>b.click());await expect(editor).toBeVisible();await mkdir(evidence+'/timeline',{recursive:true});await editor.screenshot({path:`${evidence}/timeline/${info.project.name}.png`});
 await editor.locator('[data-axis=restore]').click();expect(await page.evaluate(()=>app.settings.tracks[0].lyrics)).toContain('[00:00.20]第一句');await page.evaluate(()=>app.dispose());expect(await page.evaluate(()=>liveURLs.size)).toBe(0);
});
test('cover colors leave the saved design and Audio untouched and fall back on tainted artwork',async({page},info)=>{
 await fixture(page);await page.evaluate(()=>{window.authorDesign=JSON.stringify(app.getDesign());window.beforeCover=getComputedStyle(document.querySelector('#stm-player')).getPropertyValue('--stm-solid');app.audio.play();const c=document.createElement('canvas');c.width=c.height=16;const x=c.getContext('2d');x.fillStyle='#ed983e';x.fillRect(0,0,16,16);document.querySelector('.stm-cover-image').src=c.toDataURL();});
 await expect.poll(()=>page.evaluate(()=>app.audio.currentTime)).toBeGreaterThan(.1);await page.evaluate(()=>{const s=document.querySelector('#stm-cover-colors');s.value='strong';s.dispatchEvent(new Event('change'));});
 await expect(page.locator('#stm-player')).toHaveAttribute('data-cover-follow','true');expect(await page.evaluate(()=>getComputedStyle(document.querySelector('#stm-player')).getPropertyValue('--stm-solid')!==beforeCover)).toBe(true);expect(await page.evaluate(()=>app.audio===originalAudio&&!app.audio.paused&&JSON.stringify(app.getDesign())===authorDesign)).toBe(true);
 const colors=await page.locator('#stm-player').evaluate(n=>['--design-background','--read-body'].map(k=>getComputedStyle(n).getPropertyValue(k)));expect(colors.every(Boolean)).toBe(true);
 await page.evaluate(()=>{const s=document.querySelector('#stm-cover-colors');s.value='off';s.dispatchEvent(new Event('change'));window.baseArt=getComputedStyle(document.querySelector('#stm-player')).getPropertyValue('--design-background');});
 const png=await page.locator('.stm-cover-image').getAttribute('src');await page.route('http://localhost:8000/creative-art.png',r=>r.fulfill({contentType:'image/png',body:Buffer.from(png.split(',')[1],'base64')}));
 await page.evaluate(()=>{document.querySelector('.stm-cover-image').src='http://localhost:8000/creative-art.png';const s=document.querySelector('#stm-cover-colors');s.value='strong';s.dispatchEvent(new Event('change'));});
 await expect.poll(()=>page.evaluate(()=>{const img=document.querySelector('.stm-cover-image');return img.currentSrc.includes('creative-art.png')&&img.complete&&img.naturalWidth>0;})).toBe(true);
 expect(await page.evaluate(()=>getComputedStyle(document.querySelector('#stm-player')).getPropertyValue('--design-background')===baseArt)).toBe(true);
 await mkdir(evidence+'/colors',{recursive:true});await page.locator('#stm-player').screenshot({path:`${evidence}/colors/${info.project.name}.png`});await page.evaluate(()=>app.dispose());
});
test('quick scenes open from the launcher without opening the window or restarting shared music',async({page},info)=>{
 await fixture(page);await page.locator('[data-action=play]').click();await expect.poll(()=>page.evaluate(()=>app.audio.currentTime)).toBeGreaterThan(.1);await page.evaluate(()=>{window.beforeQuick=app.audio.src;app.setOpen(false);});
 const launcher=page.locator('#stm-launcher');if(info.project.name==='desktop')await launcher.click({button:'right'});else{const box=await launcher.boundingBox();await page.dispatchEvent('#stm-launcher','pointerdown',{pointerId:88,pointerType:'touch',clientX:box.x+15,clientY:box.y+15,button:0});await expect(page.locator('.stm-scene-quick')).toBeVisible();await page.dispatchEvent('#stm-launcher','pointerup',{pointerId:88,pointerType:'touch'});await launcher.evaluate(n=>n.click());}
 await expect(page.locator('.stm-scene-quick')).toBeVisible();await expect(page.locator('#stm-player')).toBeHidden();await page.locator('[data-quick-scene=memory]').click();await expect.poll(()=>page.evaluate(()=>app.getScene().id)).toBe('memory');expect(await page.evaluate(()=>app.audio===originalAudio&&app.audio.src===beforeQuick&&!app.audio.paused)).toBe(true);
 await launcher.click({button:'right'});await mkdir(evidence+'/quick-scenes',{recursive:true});await page.locator('.stm-scene-quick').screenshot({path:`${evidence}/quick-scenes/${info.project.name}.png`});
 await page.evaluate(()=>app.dispose());expect(await page.locator('.stm-scene-quick').count()).toBe(0);expect(await page.evaluate(()=>liveURLs.size)).toBe(0);
});
