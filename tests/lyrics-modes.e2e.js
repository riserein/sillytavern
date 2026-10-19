import { test,expect } from '@playwright/test';
import {mkdir,writeFile} from 'node:fs/promises';
const reportRoot = process.env.ST_MODES_REPORT_DIR || 'docs/lyrics-modes';
const prefix='/scripts/extensions/third-party/sillytavern/';
async function fixture(page){
 await page.route('**/modes-fixture',r=>r.fulfill({contentType:'text/html',body:`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="${prefix}ui/player.css"><style>body{margin:0;background:repeating-conic-gradient(#fff 0 25%,#000 0 50%) 0/70px 70px}</style>`}));
 await page.goto('/modes-fixture');
 await page.evaluate(async prefix=>{
  const request=window.requestAnimationFrame.bind(window),cancel=window.cancelAnimationFrame.bind(window);window.pendingMusicFrames=new Set();window.requestAnimationFrame=fn=>{const id=request(time=>{pendingMusicFrames.delete(id);fn(time)});pendingMusicFrames.add(id);return id;};window.cancelAnimationFrame=id=>{pendingMusicFrames.delete(id);cancel(id)};
  const {initialize}=await import(prefix+'index.js');
  const lyrics=Array.from({length:70},(_,i)=>`[${String(Math.floor(i/60)).padStart(2,'0')}:${String(i%60).padStart(2,'0')}]第 ${i+1} 行 · 风吹过很长很长的歌词，仍然保持完整阅读`).join('\n');
  window.ctx={extensionSettings:{riserein_music_player:{tracks:[{id:'a',kind:'url',title:'模式与显示测试',url:location.origin+prefix+'card-player/demo-assets/test-tone-a.mp3',lyrics},{id:'b',kind:'url',title:'无时间轴',url:location.origin+prefix+'card-player/demo-assets/test-tone-b.mp3',lyrics:'只有歌词原文\n没有同步时间戳'}],transitionDuration:0,fontPreset:'sans',theme:'night',colorScheme:'dark',surface:'glass',panelSize:{width:600,height:740}}},characters:[],saveSettingsDebounced(){window.saved=structuredClone(this.extensionSettings.riserein_music_player)}};
  window.app=initialize({context:ctx,previewRecovery:true});app.setOpen(true);window.originalAudio=app.audio;
 },prefix);
 await expect.poll(()=>page.evaluate(()=>Number.isFinite(app.audio.duration))).toBe(true);
}
async function mode(page,value){await page.getByRole('tab',{name:'外观',exact:true}).click();await page.locator('#stm-lyric-mode-trigger').click();await page.locator('#stm-lyric-mode-menu [data-value='+value+']').click();await page.getByRole('tab',{name:'播放',exact:true}).click();await page.locator('[data-action=toggle-lyrics]').click();}

test('three modes, continuous motion, immediate highlight, calibration and free reading share one playing audio',async({page},info)=>{
 await fixture(page);await page.locator('[data-action=play]').click();await expect.poll(()=>page.evaluate(()=>app.audio.currentTime)).toBeGreaterThan(.2);
 const evidence=[];
 for(const value of ['flow','centered','immersive']){
  const beforeMode=await page.evaluate(()=>({time:app.audio.currentTime,src:app.audio.src}));
  await mode(page,value);expect(await page.evaluate(()=>app.audio.currentTime)).toBeGreaterThanOrEqual(beforeMode.time-.05);expect(await page.evaluate(()=>app.audio.src)).toBe(beforeMode.src);await page.evaluate(()=>{app.audio.currentTime=10.7;app.audio.dispatchEvent(new Event('timeupdate'))});
  await expect(page.locator('.stm-lyrics-view')).toHaveAttribute('data-lyric-mode',value);
  await expect.poll(()=>page.locator('.stm-current-lyric').textContent()).toContain('第 11 行');
  if(value==='immersive'){
   await expect(page.locator('.stm-lyrics-scroll')).toBeHidden();await expect(page.locator('[data-immersive-current]')).toContainText('第 11 行');
   expect(await page.locator('[data-immersive-current]').evaluate(n=>n.scrollWidth<=n.clientWidth+1)).toBe(true);
  }else{
   await page.locator('.stm-lyrics-scroll').evaluate(n=>{n.dispatchEvent(new WheelEvent('wheel',{deltaY:100}));n.scrollTo({top:0,behavior:'instant'});});
   await page.locator('[data-action=resume-lyrics]').click();
   await page.waitForTimeout(80);
   const samples=await page.evaluate(async()=>{const s=document.querySelector('.stm-lyrics-scroll'),a=[];for(let i=0;i<20;i++){await new Promise(requestAnimationFrame);a.push({top:s.scrollTop,time:app.audio.currentTime,index:document.querySelector('.stm-current-lyric')?.textContent});}return a});
   evidence.push({mode:value,samples});
   const diffs=samples.slice(1).map((v,i)=>Math.abs(v.top-samples[i].top));expect(Math.max(...diffs)).toBeLessThan(35);
   expect(samples.at(-1).top).toBeGreaterThan(samples[0].top);
   await page.locator('.stm-lyrics-scroll').evaluate(n=>n.dispatchEvent(new WheelEvent('wheel',{deltaY:120})));await expect(page.locator('.stm-lyrics-view')).toHaveAttribute('data-follow','false');
   const top=await page.locator('.stm-lyrics-scroll').evaluate(n=>n.scrollTop);await page.waitForTimeout(1100);expect(await page.locator('.stm-lyrics-scroll').evaluate(n=>n.scrollTop)).toBe(top);
   await page.locator('[data-action=resume-lyrics]').click();await expect(page.locator('.stm-lyrics-view')).toHaveAttribute('data-follow','true');
  }
  expect(await page.locator('.stm-lyrics-lines p').first().evaluate(n=>getComputedStyle(n).backgroundColor)).toBe('rgba(0, 0, 0, 0)');
  await mkdir(`${reportRoot}/screenshots`,{recursive:true});await page.locator('#stm-player').screenshot({path:`${reportRoot}/screenshots/${value}-${info.project.name}.png`});
  if(await page.locator('.stm-lyric-calibration').getAttribute('open')===null)await page.locator('.stm-lyric-calibration summary').click();await page.locator('[data-offset="100"]').click();await expect(page.locator('.stm-lyric-calibration output')).toHaveText('0.1 秒');
  expect(await page.evaluate(()=>app.settings.lyricOffsets.a)).toBe(100);
  await page.locator('[data-offset=reset]').click();await page.locator('[data-action=back-cover]').click();
  expect(await page.evaluate(()=>app.audio===originalAudio&&!app.audio.paused&&document.querySelectorAll('audio').length===1)).toBe(true);
 }
 await page.getByRole('tab',{name:'曲库',exact:true}).click();await page.getByRole('button',{name:'打开歌单：总曲库',exact:true}).click();await page.locator('.stm-track-list [data-track-toggle=b]').click();await page.getByRole('tab',{name:'播放',exact:true}).click();await page.locator('[data-action=toggle-lyrics]').click();await expect(page.locator('.stm-lyrics-scroll')).toBeVisible();await expect(page.locator('[data-lyric-status]')).toHaveText('无时间轴 · 阅读原文');await expect(page.locator('.stm-lyric-immersive')).toBeHidden();await page.locator('[data-action=back-cover]').click();
 await page.evaluate(()=>{app.dispose()});await expect(page.locator('#stm-player')).toHaveCount(0);expect(await page.evaluate(()=>originalAudio.paused)).toBe(true);
 await writeFile(`${reportRoot}/motion-${info.project.name}.json`,JSON.stringify(evidence,null,2));
});

test('hidden pauses immediately, cancels sleep, keeps progress and recovers paused; no recovery degrades to dock',async({page},info)=>{
 await fixture(page);await page.locator('[data-action=play]').click();await expect.poll(()=>page.evaluate(()=>app.audio.currentTime)).toBeGreaterThan(.2);
 await page.evaluate(()=>app.audio.currentTime=8);await page.locator('.stm-sleep-button').click();await page.locator('[data-sleep-minutes="15"]').click();await page.getByRole('button',{name:'关闭睡眠定时器',exact:true}).click();
 await page.getByRole('tab',{name:'外观',exact:true}).click();await page.locator('.stm-visibility-controls [data-display-hide]').click();
 await expect(page.locator('#stm-player')).toBeHidden();await expect(page.locator('.stm-launcher')).toBeHidden();
 expect(await page.evaluate(()=>app.audio.paused&&app.visibility.state==='hidden')).toBe(true);await expect(page.locator('.stm-sleep-button')).toHaveAttribute('data-active','false');
 const savedTime=await page.evaluate(()=>app.audio.currentTime);await page.waitForTimeout(200);expect(await page.evaluate(()=>app.audio.currentTime)).toBe(savedTime);
 await page.locator('.rscp-preview-recovery').click();await expect(page.locator('.stm-launcher')).toBeVisible();expect(await page.evaluate(()=>app.audio.paused)).toBe(true);
 await page.locator('.stm-launcher').click();await expect(page.locator('#stm-player')).toBeVisible();
 await page.locator('.stm-visibility-controls [data-display-dock]').click();await expect(page.locator('.stm-launcher')).toHaveAttribute('data-display','docked');
 await page.locator('.stm-launcher').screenshot({path:`${reportRoot}/screenshots/docked-${info.project.name}.png`});
 await page.locator('.stm-launcher').click();await expect(page.locator('#stm-player')).toBeVisible();
 await page.evaluate(()=>{document.querySelector('.rscp-preview-recovery').remove();app.dispose();ctx.extensionSettings.riserein_music_player.visibility={state:'hidden'};});
 await page.evaluate(async prefix=>{const {initialize}=await import(prefix+'index.js');window.app=initialize({context:ctx});},prefix);
 expect(await page.evaluate(()=>app.visibility.state)).toBe('docked');await expect(page.locator('.stm-launcher')).toBeVisible();
 await page.evaluate(()=>app.dispose());await expect(page.locator('[data-riserein-recovery]')).toHaveCount(0);
});

test('left and right snapping, 320px and landscape/keyboard-sized viewports keep edge tabs reachable',async({page},info)=>{
 await fixture(page);
 for(const viewport of [{width:320,height:640},{width:844,height:390},{width:390,height:360}]){
  await page.setViewportSize(viewport);await page.evaluate(()=>app.setOpen(false));
  // The real UI control owns the preference, rather than replacing a controller snapshot.
  await page.evaluate(()=>app.setOpen(true));await page.getByRole('tab',{name:'外观',exact:true}).click();await page.locator('#stm-display-snap-mode-trigger').click();await page.locator('#stm-display-snap-mode-menu [data-value=tab]').click();await page.evaluate(()=>app.setOpen(false));
  for(const edge of ['left','right']){
   const box=await page.locator('.stm-launcher').boundingBox();await page.mouse.move(box.x+box.width/2,box.y+box.height/2);await page.mouse.down();await page.mouse.move(edge==='left'?12:viewport.width-12,Math.max(80,box.y),{steps:12});await page.mouse.up();
   await expect(page.locator('.stm-launcher')).toHaveAttribute('data-display','docked');
   const b=await page.locator('.stm-launcher').boundingBox();expect(b.x).toBeGreaterThanOrEqual(0);expect(b.x+b.width).toBeLessThanOrEqual(viewport.width);expect(b.y+b.height).toBeLessThanOrEqual(viewport.height);
   await page.screenshot({path:`${reportRoot}/screenshots/${edge}-${viewport.width}-${info.project.name}.png`});await page.locator('.stm-launcher').click();await page.evaluate(()=>app.setOpen(false));
  }
 }
 await page.evaluate(()=>app.dispose());
});

test('unframed lyrics remain readable in every layout, mode, scheme and scrim on arbitrary image extremes',async({page},info)=>{
 await fixture(page);await page.emulateMedia({reducedMotion:'reduce'});
 const result=await page.evaluate(async prefix=>{
  const {contrastRatio,compositeColor,colorChannels}=await import(prefix+'ui/contrast.js');const checks=[];
  for(const layout of ['night','crystal','vinyl','cassette','pure'])for(const scheme of ['dark','light'])for(const displayMode of ['flow','centered','immersive'])for(const lyricBackground of ['auto','transparent','soft'])for(const image of [false,true]){
   document.querySelector('[data-scheme-choice='+scheme+']').click();app.settings.reading.displayMode=displayMode;app.settings.reading.lyricBackground=lyricBackground;app.setDesign({layout,theme:'mist-blue'});
   app.panel.style.backgroundImage=image?'linear-gradient(90deg,#fff,#000)':'none';document.querySelector('[data-action=toggle-lyrics]').click();app.audio.currentTime=9;app.audio.dispatchEvent(new Event('timeupdate'));await new Promise(requestAnimationFrame);
   const current=displayMode==='immersive'?document.querySelector('[data-immersive-current]'):document.querySelector('.stm-current-lyric');
   const regular=displayMode==='immersive'?document.querySelector('[data-immersive-next]'):document.querySelector('.stm-lyrics-lines p:not(.stm-current-lyric)');
   const container=displayMode==='immersive'?document.querySelector('.stm-lyric-immersive'):document.querySelector('.stm-lyrics-scroll'),mask=getComputedStyle(container).backgroundColor;
   for(const [name,node]of [['current',current],['regular',regular]]){const css=getComputedStyle(node);checks.push({layout,scheme,displayMode,lyricBackground,image,name,boxAlpha:colorChannels(css.backgroundColor)[3],ratio:Math.min(...['#000000','#ffffff'].map(bg=>contrastRatio(css.color,compositeColor(mask,bg))))});}
   document.querySelector('[data-action=back-cover]').click();
  }
  return checks;
 },prefix);
 expect(result).toHaveLength(180*2);expect(result.filter(r=>r.ratio<4.5||r.boxAlpha!==0)).toEqual([]);
 await mkdir(`${reportRoot}/results`,{recursive:true});await writeFile(`${reportRoot}/results/modes-contrast-${info.project.name}.json`,JSON.stringify(result,null,2));
 for(const scheme of ['dark','light'])for(const displayMode of ['flow','centered','immersive']){
  await page.evaluate(({scheme,displayMode})=>{document.querySelector('[data-scheme-choice='+scheme+']').click();app.settings.reading.displayMode=displayMode;app.settings.reading.lyricBackground='auto';app.setDesign({layout:'crystal',theme:'mist-blue'});app.panel.style.backgroundImage='linear-gradient(110deg,#fff,#000)';document.querySelector('[data-action=toggle-lyrics]').click();app.audio.currentTime=9;app.audio.dispatchEvent(new Event('timeupdate'));},{scheme,displayMode});
  await page.locator('#stm-player').screenshot({path:`${reportRoot}/screenshots/${displayMode}-${scheme}-${info.project.name}.png`});await page.locator('[data-action=back-cover]').click();
 }
 await page.evaluate(()=>app.dispose());
});

test('classic standalone runtime supports author-docked entry, personal hiding and explicit preview recovery',async({page},info)=>{
 await fixture(page);await page.evaluate(async prefix=>{
  app.dispose();const blob=await(await fetch(location.origin+prefix+'card-player/demo-assets/test-tone-a.mp3')).blob(),src=await new Promise(resolve=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.readAsDataURL(blob);});const {mountCardPlayer}=await import(prefix+'card-player/runtime.js');const noop=()=>()=>{};
  window.legacyApp=mountCardPlayer({id:'legacy-hide',title:'独立预览',recipientDisplay:'docked',tracks:[{id:'a',title:'独立歌曲',src,lyrics:'[00:00]第一句\n[00:02]第二句'}]}, {hostDocument:document,hostWindow:window,roleId:'preview',scriptId:'legacy-hide',currentRole:()=> 'preview',onRoleChange:noop,onScriptExit:noop,onHostExit:noop,onFrameRemoved:noop});
 },prefix);
 await expect(page.locator('.ball')).toHaveAttribute('data-display','docked');await expect(page.locator('.panel')).toBeHidden();
 await page.locator('.ball').click();await expect(page.locator('.panel')).toBeVisible();await page.locator('.play').click();await expect.poll(()=>page.evaluate(()=>legacyApp.audio.currentTime)).toBeGreaterThan(.1);
 await page.locator('.stm-visibility-controls [data-display-hide]').click();const hiddenTime=await page.evaluate(()=>legacyApp.audio.currentTime);await page.evaluate(()=>legacyApp.audio.dispatchEvent(new Event('ended')));await page.waitForTimeout(100);expect(await page.evaluate(()=>legacyApp.audio.currentTime)).toBe(hiddenTime);await expect(page.locator('.ball')).toBeHidden();await expect(page.locator('.panel')).toBeHidden();expect(await page.evaluate(()=>legacyApp.audio.paused)).toBe(true);
 await page.locator('.rscp-preview-recovery').click();await expect(page.locator('.ball')).toBeVisible();expect(await page.evaluate(()=>legacyApp.audio.paused)).toBe(true);
 await page.locator('.ball').click();await page.locator('.stm-reading-settings summary').click();await page.locator('#stm-lyric-mode').selectOption('immersive');await page.locator('.cover').click();await expect(page.locator('.lyrics')).toHaveAttribute('data-lyric-mode','immersive');
 await page.screenshot({path:`${reportRoot}/screenshots/classic-${info.project.name}.png`});await page.evaluate(()=>legacyApp.dispose());await expect(page.locator('[data-riserein-recovery]')).toHaveCount(0);expect(await page.evaluate(()=>legacyApp.audio.paused)).toBe(true);
});

test('late ended events while hidden cannot switch the selected song',async({page})=>{
 await fixture(page);await page.locator('[data-action=play]').click();await expect.poll(()=>page.evaluate(()=>app.audio.currentTime)).toBeGreaterThan(.1);
 await page.evaluate(()=>{app.audio.currentTime=8;app.visibility.setState('hidden');window.hiddenSource=app.audio.src;app.audio.dispatchEvent(new Event('ended'));});
 await page.waitForTimeout(150);expect(await page.evaluate(()=>({id:app.settings.currentId,time:app.audio.currentTime,same:app.audio.src===hiddenSource,paused:app.audio.paused}))).toEqual({id:'a',time:8,same:true,paused:true});
 await page.locator('.rscp-preview-recovery').click();await page.evaluate(()=>app.audio.dispatchEvent(new Event('ended')));await page.waitForTimeout(100);expect(await page.evaluate(()=>({id:app.settings.currentId,time:app.audio.currentTime,paused:app.audio.paused}))).toEqual({id:'a',time:8,paused:true});
 await page.evaluate(()=>app.dispose());
});

test('losing the only visible Helper recovery route falls back to a clickable edge tag',async({page})=>{
 await fixture(page);await page.evaluate(async prefix=>{app.dispose();const {initialize}=await import(prefix+'index.js');const bar=document.createElement('div');bar.id='helper-fixture-bar';bar.innerHTML='<div id="script_container_fixture"><button>显示/隐藏角色音乐</button></div>';document.body.append(bar);window.app=initialize({context:ctx,helperRecovery:{scriptId:'fixture',available:()=>true,subscribe:()=>()=>{}}});app.setOpen(true);},prefix);
 await page.getByRole('tab',{name:'外观',exact:true}).click();await page.locator('.stm-visibility-controls [data-display-hide]').click();await expect(page.locator('.stm-launcher')).toBeHidden();
 await page.locator('#helper-fixture-bar').evaluate(n=>n.hidden=true);await expect(page.locator('.stm-launcher')).toHaveAttribute('data-display','docked');await expect(page.locator('.stm-launcher')).toBeVisible();
 await page.locator('.stm-launcher').click();await expect(page.locator('#stm-player')).toBeVisible();expect(await page.evaluate(()=>app.audio.paused)).toBe(true);await page.evaluate(()=>app.dispose());
});

test('active lyric animation releases all pending frames on hide and dispose',async({page})=>{
 await fixture(page);await page.locator('[data-action=play]').click();await page.locator('[data-action=toggle-lyrics]').click();await expect.poll(()=>page.evaluate(()=>pendingMusicFrames.size)).toBeGreaterThan(0);
 await page.evaluate(()=>app.visibility.setState('hidden'));await page.waitForTimeout(100);expect(await page.evaluate(()=>pendingMusicFrames.size)).toBe(0);
 await page.locator('.rscp-preview-recovery').click();await page.locator('.stm-launcher').click();await page.locator('[data-action=back-cover]').click();await page.locator('[data-action=play]').click();await page.locator('[data-action=toggle-lyrics]').click();await expect.poll(()=>page.evaluate(()=>pendingMusicFrames.size)).toBeGreaterThan(0);
 await page.evaluate(()=>app.dispose());await page.waitForTimeout(100);expect(await page.evaluate(()=>pendingMusicFrames.size)).toBe(0);expect(await page.evaluate(()=>originalAudio.paused)).toBe(true);
});
