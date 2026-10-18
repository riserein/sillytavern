import {test,expect} from '@playwright/test';
import {mkdir,readFile} from 'node:fs/promises';
import {gunzipSync} from 'node:zlib';
const prefix='/scripts/extensions/third-party/sillytavern/';
test('static icon validation rejects active formats, animations and huge dimensions before browser decode',async({page})=>{
 await page.route('**/icon-fixture',route=>route.fulfill({contentType:'text/html',body:'<!doctype html><body></body>'}));await page.goto('/icon-fixture');
 const result=await page.evaluate(async prefix=>{
  const {prepareDesignIcon}=await import(prefix+'ui/images.js');const canvas=document.createElement('canvas');canvas.width=32;canvas.height=32;canvas.getContext('2d').fillRect(0,0,32,32);const png=await new Promise(resolve=>canvas.toBlob(resolve,'image/png')),bytes=new Uint8Array(await png.arrayBuffer());let decodes=0;const original=createImageBitmap;window.createImageBitmap=(...args)=>{decodes++;return original(...args);};
  const errors=[];const huge=bytes.slice();new DataView(huge.buffer).setUint32(16,100000);
  const chunk=new Uint8Array(12);chunk.set([97,99,84,76],4);const animated=new Blob([bytes.slice(0,33),chunk,bytes.slice(33)],{type:'image/png'});
  for(const file of [new Blob(['<svg onload="window.injected=true"></svg>'],{type:'image/png'}),new Blob([huge],{type:'image/png'}),animated,new Blob([new Uint8Array(2*1024*1024)],{type:'image/png'})]){try{await prepareDesignIcon(file);}catch(error){errors.push(error.message);}}
  const before=decodes,valid=await prepareDesignIcon(png),image=await createImageBitmap(valid);const size=[image.width,image.height];image.close();return {errors,before,type:valid.type,size,injected:Boolean(window.injected)};
 },prefix);expect(result.errors.length).toBe(4);expect(result.before).toBe(0);expect(result.type).toMatch(/^image\/(webp|png)$/);expect(result.size).toEqual([32,32]);expect(result.injected).toBe(false);
});
test('controlled real-audio presentation changes four layouts without replacing or seeking Audio, on desktop and mobile viewport',async({page})=>{
 test.slow();await mkdir('docs/v2/ui',{recursive:true});
 await page.route('**/design-fixture',route=>route.fulfill({contentType:'text/html',body:`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="${prefix}night-ui.css"><link rel="stylesheet" href="${prefix}ui/layouts.css"><style>body{background:linear-gradient(125deg,#c2c9c9,#6d8082);height:100vh;margin:0}</style><body></body>`}));
 await page.goto('/design-fixture');
 await page.evaluate(async prefix=>{
  const {initialize}=await import(prefix+'index.js');
  const context={extensionSettings:{riserein_music_player:{tracks:[{id:'tone',title:'夜晚的回声',artist:'原创合成测试音',kind:'url',url:location.origin+prefix+'card-player/demo-assets/test-tone-a.mp3'}],theme:'night',colorScheme:'dark',surface:'matte',panelSize:{width:580,height:740},fontPreset:'sans'}},characters:[],saveSettingsDebounced(){}};
  window.app=initialize({context});app.setOpen(true);
  window.keptAudio=app.audio;
 },prefix);
 await page.locator('[data-action=play]').click();await expect.poll(()=>page.locator('audio').evaluate(a=>a.currentTime)).toBeGreaterThan(.3);
 for(const mobile of [false,true]){
  await page.setViewportSize(mobile?{width:390,height:844}:{width:1280,height:1000});
  for(const [layout,theme] of [['crystal','mist-blue'],['vinyl','walnut'],['cassette','smoke'],['pure','cream']]){
   const previous=await page.locator('audio').evaluate(a=>a.currentTime);
   await page.evaluate(({layout,theme})=>app.setDesign({layout,theme,launcher:'vinyl'}),{layout,theme});
   await expect(page.locator('#stm-player')).toHaveAttribute('data-layout',layout);
   expect(await page.evaluate(()=>app.audio===keptAudio&&!keptAudio.paused)).toBe(true);await expect.poll(()=>page.locator('audio').evaluate(a=>a.currentTime)).toBeGreaterThan(previous);
   const play=page.locator('[data-action=play]');await play.scrollIntoViewIfNeeded();const panel=await page.locator('#stm-player').boundingBox(),button=await play.boundingBox();expect(button.x).toBeGreaterThanOrEqual(panel.x);expect(button.x+button.width).toBeLessThanOrEqual(panel.x+panel.width+1);
   await page.locator('[data-view=playback]').evaluate(node=>node.scrollTop=0);
   await page.locator('#stm-player').screenshot({path:`docs/v2/ui/controlled-${layout}-${mobile?'mobile':'desktop'}.png`});
  }
 }
 await page.evaluate(()=>app.dispose());await expect(page.locator('audio')).toHaveCount(0);
});
async function choose(page,id,value){const text=await page.locator(id).evaluate((select,value)=>[...select.options].find(option=>option.value===value).textContent,value);await page.locator(id+'-trigger').click();await page.locator(id+'-menu').getByRole('option',{name:text,exact:true}).click();}
test('real SillyTavern switches, plays, navigates lyrics/queue and saves four designs without losing legacy settings',async({page})=>{
 test.slow();await mkdir('docs/v2/ui',{recursive:true});await page.setViewportSize({width:1280,height:1000});
 await page.route('**/api/settings/get',async route=>{const response=await route.fetch(),body=await response.json(),settings=JSON.parse(body.settings);settings.firstRun=false;settings.main_api='kobold';settings.api_server='';settings.extension_settings||={};settings.extension_settings.riserein_music_player={tracks:[],theme:'night',colorScheme:'dark',surface:'matte',fontPreset:'sans',panelSize:{width:600,height:760}};body.settings=JSON.stringify(settings);await route.fulfill({response,json:body});});
 await page.goto('/');await expect(page.locator('#stm-launcher')).toBeVisible({timeout:30000});await page.waitForFunction(()=>!document.getElementById('preloader'));await page.evaluate(async()=>{await(await import('/script.js')).closeCurrentChat();});await page.unroute('**/api/settings/get');await page.locator('#stm-launcher').click();await expect(page.locator('#stm-player')).toHaveAttribute('data-layout','night');
 await page.route('**/ui-missing.mp3',route=>route.fulfill({status:404,contentType:'audio/mpeg',body:''}));
 const tone=await readFile(new URL('../card-player/demo-assets/test-tone-a.mp3',import.meta.url));await page.getByRole('tab',{name:'导入',exact:true}).click();await page.locator('[data-role=files]').setInputFiles(['夜晚的回声','海岸来信'].map(name=>({name:name+'.mp3',mimeType:'audio/mpeg',buffer:tone})));await expect(page.locator('.stm-status')).toContainText('已导入 2 首音乐');
 await page.getByRole('tab',{name:'曲库',exact:true}).click();await page.locator('.stm-collection-open[data-collection-id=""]').click();await page.getByRole('button',{name:'歌曲详情：夜晚的回声',exact:true}).click();await page.locator('[data-role=lyrics-file]').setInputFiles({name:'test.lrc',mimeType:'text/plain',buffer:Buffer.from('[00:00]起点\n[00:02]听见星光')});await page.getByRole('button',{name:'关闭歌曲详情',exact:true}).click();await page.getByRole('tab',{name:'播放',exact:true}).click();await page.locator('[data-action=play]').click();await expect.poll(()=>page.locator('#stm-player audio').evaluate(a=>a.currentTime)).toBeGreaterThan(.3);
 await page.evaluate(()=>{window.keptAudio=document.querySelector('#stm-player audio');window.keptSource=keptAudio.src;});
 for(const mobile of [false,true]){
  await page.setViewportSize(mobile?{width:390,height:844}:{width:1280,height:1000});
  for(const [layout,theme]of [['crystal','mist-blue'],['vinyl','walnut'],['cassette','smoke'],['pure','cream']]){
   const before=await page.locator('#stm-player audio').evaluate(a=>a.currentTime);await page.getByRole('tab',{name:'外观',exact:true}).click();await choose(page,'#stm-design-layout',layout);await choose(page,'#stm-design-theme',theme);await page.getByRole('tab',{name:'播放',exact:true}).click();await expect(page.locator('#stm-player')).toHaveAttribute('data-layout',layout);
   expect(await page.evaluate(()=>keptAudio===document.querySelector('#stm-player audio')&&keptAudio.src===keptSource&&!keptAudio.paused)).toBe(true);await expect.poll(()=>page.locator('#stm-player audio').evaluate(a=>a.currentTime)).toBeGreaterThan(before);await page.locator('#stm-player').screenshot({path:`docs/v2/ui/live-${layout}-${mobile?'mobile':'desktop'}.png`});
   await page.locator('[data-action=toggle-lyrics]').click();await expect(page.locator('.stm-lyrics-view')).toContainText('听见星光');await page.getByRole('button',{name:'显示封面',exact:true}).click();await page.locator('[data-action=toggle-queue]').click();await expect(page.locator('.stm-queue-track')).toHaveCount(2);await page.getByRole('button',{name:'关闭播放列表',exact:true}).click();
   await page.locator('#stm-player audio').evaluate(a=>{a.src='/ui-missing.mp3';a.load();});await expect(page.locator('#stm-player')).toHaveAttribute('data-audio-state','error');await expect(page.locator('.stm-status')).toContainText('加载失败');await page.locator('[data-action=play]').click();await expect.poll(()=>page.locator('#stm-player audio').evaluate(a=>a.currentTime)).toBeGreaterThan(.1);expect(await page.evaluate(()=>keptAudio===document.querySelector('#stm-player audio'))).toBe(true);await page.evaluate(()=>{keptSource=keptAudio.src;});
  }
 }
 await page.getByRole('tab',{name:'外观',exact:true}).click();const saved=page.waitForResponse(response=>{if(!response.url().endsWith('/api/settings/save')||!response.ok())return false;try{const request=response.request(),body=request.headers()['content-encoding']==='gzip'?JSON.parse(gunzipSync(request.postDataBuffer()).toString()):request.postDataJSON();return body.extension_settings?.riserein_music_player?.uiDesign?.layout==='pure';}catch{return false;}});
 await choose(page,'#stm-design-theme','cream');await saved;await page.reload();await expect(page.locator('#stm-launcher')).toBeVisible();await page.waitForFunction(()=>!document.getElementById('preloader'));await page.locator('#stm-launcher').click();await expect(page.locator('#stm-player')).toHaveAttribute('data-layout','pure');
 const restored=await page.evaluate(()=>SillyTavern.getContext().extensionSettings.riserein_music_player);expect(restored.theme).toBe('night');expect(restored.fontPreset).toBe('sans');expect(restored.tracks.length).toBe(2);expect(await page.locator('#stm-player audio').evaluate(a=>a.paused)).toBe(true);
});
test('five real host launchers drag, control one audio and keep custom icons above a mobile input',async({page})=>{
 test.slow();await page.setViewportSize({width:390,height:844});await page.route('**/api/settings/get',async route=>{const response=await route.fetch(),body=await response.json(),settings=JSON.parse(body.settings);settings.firstRun=false;settings.main_api='kobold';settings.api_server='';settings.extension_settings||={};settings.extension_settings.riserein_music_player={tracks:[{id:'float-tone',kind:'url',title:'悬浮组件测试音',url:new URL(prefix+'card-player/demo-assets/test-tone-a.mp3',new URL(route.request().url()).origin).href}],theme:'night',colorScheme:'dark',fontPreset:'sans',volume:.4,panelSize:{width:500,height:700}};body.settings=JSON.stringify(settings);await route.fulfill({response,json:body});});
 await page.goto('/');await expect(page.locator('#stm-launcher')).toBeVisible({timeout:30000});await page.waitForFunction(()=>!document.getElementById('preloader'));await page.evaluate(async()=>{await(await import('/script.js')).closeCurrentChat();});await page.unroute('**/api/settings/get');await page.locator('#stm-launcher').click();await page.locator('[data-action=play]').click();await expect.poll(()=>page.locator('#stm-player audio').evaluate(a=>a.currentTime)).toBeGreaterThan(.2);await page.evaluate(()=>window.keptAudio=document.querySelector('#stm-player audio'));
 await page.getByRole('tab',{name:'外观',exact:true}).click();const icon=Buffer.from(await page.evaluate(()=>{const c=document.createElement('canvas');c.width=64;c.height=64;const p=c.getContext('2d');p.fillStyle='#84b7cc';p.beginPath();p.arc(32,32,29,0,Math.PI*2);p.fill();return c.toDataURL('image/png').split(',')[1];}),'base64');
 await page.locator('[data-launcher-file]').setInputFiles({name:'own-icon.png',mimeType:'image/png',buffer:icon});await expect(page.locator('[data-launcher-status]')).toContainText('图标已保存');
 const id=await page.evaluate(()=>SillyTavern.getContext().extensionSettings.riserein_music_player.uiDesign.customization.iconId);
 await page.locator('[data-launcher-file]').setInputFiles({name:'wrong.png',mimeType:'image/png',buffer:Buffer.from('<svg onload="alert(1)"></svg>')});await expect(page.locator('[data-launcher-status]')).toContainText('PNG');expect(await page.evaluate(()=>SillyTavern.getContext().extensionSettings.riserein_music_player.uiDesign.customization.iconId)).toBe(id);
 for(const kind of ['vinyl','cd','cassette','capsule','custom']){
  await choose(page,'#stm-design-launcher',kind);await page.locator('[data-action=close]').click();const root=page.locator('#stm-launcher');await expect(root).toHaveAttribute('data-launcher',kind);await expect(root).toBeVisible();
  if(kind==='capsule'){await root.locator('.stm-launch-play').click();await expect.poll(()=>page.locator('#stm-player audio').evaluate(a=>a.paused)).toBe(true);await root.locator('.stm-launch-play').click();await expect.poll(()=>page.locator('#stm-player audio').evaluate(a=>!a.paused)).toBe(true);}
  if(kind==='custom')await expect.poll(()=>root.locator('.stm-launch-custom').evaluate(i=>i.naturalWidth)).toBe(64);
  const b=await root.boundingBox();await page.mouse.move(b.x+15,b.y+b.height/2);await page.mouse.down();await page.mouse.move(b.x+35,b.y+b.height/2-25,{steps:4});await page.mouse.up();await expect(page.locator('#stm-player')).toBeHidden();expect(await page.evaluate(()=>keptAudio===document.querySelector('#stm-player audio')&&!keptAudio.paused)).toBe(true);
  await root.click({position:{x:kind==='capsule'?60:20,y:20}});await expect(page.locator('#stm-player')).toBeVisible();await page.getByRole('tab',{name:'外观',exact:true}).click();
 }
 await page.locator('[data-action=close]').click();await page.locator('#send_form').evaluate(el=>Object.assign(el.style,{height:'180px'}));await expect.poll(async()=>{const input=await page.locator('#send_form').boundingBox();return input.y>0&&input.y+input.height<=844;}).toBe(true);await page.evaluate(()=>{const input=document.querySelector('#send_form').getBoundingClientRect(),ball=document.querySelector('#stm-launcher');ball.style.top=(input.top+20)+'px';ball.style.left='150px';dispatchEvent(new Event('resize'));});
 await expect.poll(async()=>{const ball=await page.locator('#stm-launcher').boundingBox(),input=await page.locator('#send_form').boundingBox();return ball.y+ball.height<=input.y-7;}).toBe(true);expect(await page.evaluate(()=>keptAudio===document.querySelector('#stm-player audio')&&!keptAudio.paused)).toBe(true);
 await mkdir('docs/v2/ui/launchers',{recursive:true});await page.screenshot({path:'docs/v2/ui/launchers/mobile-input-avoidance.png'});
});
