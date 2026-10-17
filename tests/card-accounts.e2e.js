import {test,expect} from '@playwright/test';
import {readFile} from 'node:fs/promises';
const prefix='/scripts/extensions/third-party/sillytavern/';
// Fail closed: this suite creates accounts and writes settings only in its owned disposable host.
test.beforeAll(async()=>{
 if(process.env.ST_MULTI_FIXTURE!=='1')throw new Error('Requires explicit disposable multi-account fixture');
 const marker=JSON.parse(await readFile('/workspace/scratch/stm-v133-multi-fixture.json','utf8'));
 const command=(await readFile(`/proc/${marker.pid}/cmdline`,'utf8')).split('\0');
 expect(marker.purpose).toBe('music-plugin-v133-isolation-only');expect(marker.port).toBe(8133);
 expect(command[command.indexOf('--dataRoot')+1]).toBe('/workspace/scratch/stm-v133-multi-data');expect(command[command.indexOf('--port')+1]).toBe('8133');
});
async function login(request,handle){
 const response=await request.get('/csrf-token'),{token}=await response.json();
 const result=await request.post('/api/users/login',{headers:{'X-CSRF-Token':token},data:{handle,password:''}});expect(result.ok()).toBeTruthy();
}
async function ready(page){
 await page.goto('/');await expect(page.locator('#stm-launcher')).toBeVisible({timeout:60000});await page.waitForFunction(()=>!document.getElementById('preloader'));
}
async function prepare(request,handle){
 await login(request,handle);const {token}=await(await request.get('/csrf-token')).json(),headers={'X-CSRF-Token':token,'Content-Type':'application/json'};
 const response=await request.post('/api/settings/get',{headers,data:{}}),settings=JSON.parse((await response.json()).settings);
 settings.firstRun=false;settings.extension_settings||={};settings.extension_settings.riserein_music_player={tracks:[],fontPreset:'inherit',volume:.2};
 expect((await(await request.post('/api/settings/save',{headers,data:settings})).json()).result).toBe('ok');
}
test('real SillyTavern accounts isolate library/drafts and reject an old page saving into the new account',async({browser})=>{
 const context=await browser.newContext(),request=context.request;
 try{
  await login(request,'default-user');const {token}=await(await request.get('/csrf-token')).json(),headers={'X-CSRF-Token':token};
  const users=await(await request.post('/api/users/get',{headers,data:{}})).json();
  for(const [handle,name] of [['stm-v133-a','Music v1.13.3 fixture A'],['stm-v133-b','Music v1.13.3 fixture B']]){
   const found=users.find(u=>u.handle===handle);if(found)expect(found.name).toBe(name);else expect((await request.post('/api/users/create',{headers,data:{handle,name,password:'',admin:false}})).ok()).toBeTruthy();
  }
  await prepare(request,'stm-v133-a');const a=await context.newPage();await ready(a);
  const accountA=await a.evaluate(async prefix=>{
   const {getStorageScope}=await import(prefix+'data/identity.js'),{LocalMusicStore}=await import(prefix+'local-store.js'),{CardProjectStore}=await import(prefix+'card-player/project-store.js');
   window.testStore=new LocalMusicStore();window.testProjects=new CardProjectStore();await testStore.put('shared-id',new Blob(['private-A']));
   const old=await testProjects.get('shared-project');await testProjects.save({id:'shared-project',title:'private-A',format:1,tracks:[],sourceSettings:{},form:{'stm-maker-title':'private-A'}},old?.revision||0);return getStorageScope();
  },prefix);expect(accountA.verified).toBe(true);
  await a.locator('#stm-launcher').click();await a.getByRole('tab',{name:'导入',exact:true}).click();
  await a.locator('[data-role=files]').setInputFiles({name:'account-A.mp3',mimeType:'audio/mpeg',buffer:await readFile(new URL('../card-player/demo-assets/test-tone-a.mp3',import.meta.url))});
  await expect(a.locator('.stm-status')).toContainText('已导入 1 首');
  await expect.poll(async()=>{const response=await request.post('/api/settings/get',{headers:(await a.evaluate(()=>SillyTavern.getContext().getRequestHeaders()))});return JSON.parse((await response.json()).settings).extension_settings?.riserein_music_player?.tracks?.length;}).toBe(1);
  await a.reload();await expect(a.locator('#stm-launcher')).toBeVisible();await a.locator('#stm-launcher').click();await a.getByRole('tab',{name:'播放',exact:true}).click();await a.locator('[data-action=play]').click();
  await expect.poll(()=>a.locator('#stm-player audio').evaluate(n=>!n.paused&&n.currentTime>0)).toBe(true);
  await a.evaluate(()=>window.previousAudio=document.querySelector('#stm-player audio'));
  await a.getByRole('tab',{name:'外观',exact:true}).click();await a.locator('[data-role=data-tools]>summary').click();
  const downloading=a.waitForEvent('download');await a.locator('[data-data=backup]').click();const zip=await readFile(await(await downloading).path());
  await prepare(request,'stm-v133-b');const b=await context.newPage();await ready(b);
  const accountB=await b.evaluate(async prefix=>{
   const {getStorageScope}=await import(prefix+'data/identity.js'),{LocalMusicStore}=await import(prefix+'local-store.js'),{CardProjectStore}=await import(prefix+'card-player/project-store.js');
   const s=new LocalMusicStore(),p=new CardProjectStore(),before={resources:await s.count(),projects:await p.count()};await s.put('shared-id',new Blob(['private-B']));await p.save({id:'shared-project',title:'private-B'});await s.delete('shared-id');await p.delete('shared-project');return {scope:getStorageScope(),before};
  },prefix);expect(accountB.scope.key).not.toBe(accountA.key);expect(accountB.before).toEqual({resources:0,projects:0});
  // New verified account announces the cookie-session change to old background players.
  await expect(a.locator('#stm-player')).toHaveCount(0);expect(await a.evaluate(()=>previousAudio.paused)).toBe(true);
  const retained=await a.evaluate(async({prefix,scope})=>{const {LocalMusicStore}=await import(prefix+'local-store.js'),{CardProjectStore}=await import(prefix+'card-player/project-store.js');return {audio:await(await new LocalMusicStore({scope}).get('shared-id')).text(),project:(await new CardProjectStore(indexedDB,{scope}).get('shared-project')).title};},{prefix,scope:accountA.key});expect(retained).toEqual({audio:'private-A',project:'private-A'});
  const staleSave=await a.evaluate(async()=>{const c=SillyTavern.getContext(),response=await fetch('/api/settings/save',{method:'POST',headers:c.getRequestHeaders(),body:JSON.stringify({extension_settings:c.extensionSettings})});return response.status;});expect(staleSave).toBe(409);
  await expect(a.locator('#stm-player')).toHaveCount(0);await expect(a.locator('#stm-launcher')).toHaveCount(0);
  expect(await a.evaluate(()=>({paused:previousAudio.paused,src:previousAudio.getAttribute('src')}))).toEqual({paused:true,src:null});
  const remote=await request.post('/api/settings/get',{headers:await b.evaluate(()=>SillyTavern.getContext().getRequestHeaders())});expect(JSON.parse((await remote.json()).settings).extension_settings?.riserein_music_player?.tracks||[]).toHaveLength(0);
  await b.locator('#stm-launcher').click();await b.getByRole('tab',{name:'外观',exact:true}).click();await b.locator('[data-role=data-tools]>summary').click();b.on('dialog',d=>d.accept());
  await b.locator('[data-data=file]').setInputFiles({name:'account-A.zip',mimeType:'application/zip',buffer:zip});await expect(b.locator('[data-data=status]')).toContainText('备份校验通过');await b.locator('[data-data=preview]').click();await expect(b.locator('[data-data=status]')).toContainText('恢复计划已核对');await b.locator('[data-data=apply]').click();await expect(b.locator('[data-data=status]')).toContainText('恢复完成',{timeout:30000});
  const saved=await request.post('/api/settings/get',{headers:await b.evaluate(()=>SillyTavern.getContext().getRequestHeaders())});expect(JSON.parse((await saved.json()).settings).extension_settings.riserein_music_player.tracks).toHaveLength(1);
  await b.reload();await expect(b.locator('#stm-launcher')).toBeVisible();await b.locator('#stm-launcher').click();await b.getByRole('tab',{name:'播放',exact:true}).click();await b.locator('[data-action=play]').click();await expect.poll(()=>b.locator('#stm-player audio').evaluate(n=>!n.paused&&n.currentTime>0)).toBe(true);
 }finally{await context.close().catch(()=>{});}
});
