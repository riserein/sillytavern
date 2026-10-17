import {test,expect,chromium} from '@playwright/test';
import {readFile,mkdtemp,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {inspectBackup} from '../data/backup.js';
const prefix='/scripts/extensions/third-party/sillytavern/';
const tone=await readFile(new URL('../card-player/demo-assets/test-tone-a.mp3',import.meta.url));
async function fixture(page,{seed=true,legacy=false}={}){
 await page.route('**/data-fixture',r=>r.fulfill({contentType:'text/html',body:`<!doctype html><meta charset="utf-8"><link rel="stylesheet" href="${prefix}night-ui.css"><body><section id="extensions_settings"></section></body>`}));
 await page.route('**/api/settings/get',async r=>r.fulfill({json:{settings:JSON.stringify(await page.evaluate(()=>window.remoteSettings))}}));
 await page.route('**/api/settings/save',async r=>{
  const failed=await page.evaluate(()=>window.failSave);
  if(failed)return r.fulfill({status:500,json:{error:'controlled disk failure'}});
  const data=r.request().postDataJSON();await page.evaluate(data=>{window.remoteSettings=data;},data);return r.fulfill({json:{result:'ok'}});
 });
 await page.goto('/data-fixture');
 await page.evaluate(async({prefix,seed,tone,legacy})=>{
  const {setStorageScope}=await import(prefix+'data/identity.js');
  const account={key:'account-'+'a'.repeat(64),verified:true,label:'Test account'};setStorageScope(account);
  const {fixture}=await import(prefix+'tests/data-fixtures.js');
  const source=fixture();if(seed){source.entries[0][1]=new Blob([new Uint8Array(tone)],{type:'audio/mpeg'});source.projects[0].tracks[0].exportBlob=source.entries[0][1];}
  const {LocalMusicStore}=await import(prefix+'local-store.js'),{CardProjectStore}=await import(prefix+'card-player/project-store.js'),{initialize}=await import(prefix+'index.js');
  window.library=new LocalMusicStore();window.drafts=new CardProjectStore();
  if(seed){const music=legacy?new LocalMusicStore({scope:'legacy'}):library,projects=legacy?new CardProjectStore(indexedDB,{scope:'legacy'}):drafts;for(const [id,blob]of source.entries)await music.put(id,blob);await projects.save(source.projects[0]);if(legacy){await music.close();await projects.dispose();}}
  window.remoteSettings={extension_settings:{riserein_music_player:seed?source.settings:undefined},oai_settings:{api_key:'PRIVATE-HOST-CREDENTIAL'},chat:['PRIVATE-HOST-CHAT']};
  const context={extensionSettings:structuredClone(remoteSettings.extension_settings),characters:[{avatar:'b.png',name:'Target character'}],getRequestHeaders:()=>({'Content-Type':'application/json'}),saveSettingsDebounced(){void fetch('/api/settings/save',{method:'POST',headers:this.getRequestHeaders(),body:JSON.stringify({extension_settings:this.extensionSettings,oai_settings:{api_key:'PRIVATE-HOST-CREDENTIAL'}})});}};
  window.app=initialize({context,account,assertAccount:async()=>account});app.setOpen(true);
 },{prefix,seed,legacy,tone:[...tone]});
 await page.getByRole('tab',{name:'外观',exact:true}).click();await page.locator('[data-role=data-tools]>summary').click();
}
async function exportZip(page){
 const pending=page.waitForEvent('download');await page.locator('[data-data=backup]').click();const file=await pending;return readFile(await file.path());
}
async function importZip(page,bytes){
 await page.locator('[data-data=file]').setInputFiles({name:'music.zip',mimeType:'application/zip',buffer:bytes});
 await expect(page.locator('[data-data=status]')).toContainText('备份校验通过');
 await page.locator('[data-data=preview]').click();await expect(page.locator('[data-data=status]')).toContainText('恢复计划已核对');
}
test.afterEach(async({page})=>{await page.evaluate(()=>window.app?.dispose()).catch(()=>{});});
test('complete ZIP download includes actual library/project bytes and excludes host credentials; preview is read-only',async({page})=>{
 await fixture(page);const zip=await exportZip(page),restored=await inspectBackup(new Blob([zip]));
 expect(restored.manifest.settings.tracks).toHaveLength(2);expect(restored.projects).toHaveLength(1);expect(restored.assets).toHaveLength(5);
 expect(JSON.stringify(restored.manifest)).not.toContain('PRIVATE-HOST');
 const audio=restored.assets.find(([id])=>id===restored.manifest.settings.tracks[0].id)[1];expect(Buffer.from(await audio.arrayBuffer())).toEqual(tone);
 const before=await page.evaluate(()=>JSON.stringify(app.settings));await importZip(page,zip);
 expect(await page.evaluate(()=>JSON.stringify(app.settings))).toBe(before);await page.locator('[data-data=scan]').evaluate(n=>n.closest('details').open=true);await page.locator('[data-data=scan]').click();await expect(page.locator('[data-data=storage-text]')).toContainText('本地音频');
});
test('ZIP restores into a clean account with actual IDB, checked role remapping and preserved original project IDs',async({browser})=>{
 const a=await browser.newPage();await fixture(a);const zip=await exportZip(a);await a.close();
 const context=await browser.newContext(),page=await context.newPage();await fixture(page,{seed:false});page.on('dialog',dialog=>dialog.accept());
 await importZip(page,zip);await page.locator('[data-data=bindings] select').evaluate(n=>{n.value='b.png';n.dispatchEvent(new Event('change',{bubbles:true}));});
 await page.locator('[data-data=preview]').click();await expect(page.locator('[data-data=status]')).toContainText('恢复计划已核对');
 await page.locator('[data-data=apply]').click();await expect(page.locator('[data-data=status]')).toContainText('恢复完成',{timeout:30000});
 const result=await page.evaluate(async()=>({tracks:app.settings.tracks.length,binding:app.settings.playlists[0].characterAvatars,project:(await drafts.list())[0].id,audioBytes:(await library.get(app.settings.tracks[0].id)).size,records:(await library.entries()).length}));
 expect(result).toEqual({tracks:2,binding:['b.png'],project:'rscp:one',audioBytes:tone.length,records:5});
 await page.evaluate(()=>app.dispose());await context.close();
});
test('failed settings save keeps staged bytes and old settings; explicit readback safely rolls back only owned data',async({browser})=>{
 const author=await browser.newPage();await fixture(author);const zip=await exportZip(author);await author.close();
 const context=await browser.newContext(),page=await context.newPage();await fixture(page,{seed:false});page.on('dialog',dialog=>dialog.accept());await importZip(page,zip);
 await page.evaluate(()=>{window.failSave=true;});await page.locator('[data-data=apply]').click();await expect(page.locator('[data-data=status]')).toContainText('暂存文件',{timeout:30000});
 expect(await page.evaluate(()=>app.settings.tracks.length)).toBe(0);expect(await page.evaluate(async()=>(await library.entries()).length)).toBeGreaterThan(0);
 await page.locator('[data-data=recover]').evaluate(n=>n.closest('details').open=true);await page.locator('[data-data=recover]').click();await expect(page.locator('[data-data=recovery-text]')).toContainText('rolled-back');
 expect(await page.evaluate(async()=>(await library.entries()).length)).toBe(0);expect(await page.evaluate(async()=>(await drafts.list()).length)).toBe(0);
 await page.evaluate(()=>app.dispose());await context.close();
});
test('damaged backup never mutates existing IDB or visible settings',async({page})=>{
 await fixture(page);const bytes=await exportZip(page),before=await page.evaluate(()=>JSON.stringify(app.settings));
 await page.locator('[data-data=file]').setInputFiles({name:'broken.zip',mimeType:'application/zip',buffer:bytes.subarray(0,bytes.length-7)});
 await expect(page.locator('[data-data=status]')).toContainText('未完成');expect(await page.evaluate(()=>JSON.stringify(app.settings))).toBe(before);expect(await page.evaluate(async()=>(await library.entries()).length)).toBe(5);
});
test('same-origin account stores and project IDs are isolated and never automatically adopt legacy bytes',async({page})=>{
 await page.route('**/scope-fixture',r=>r.fulfill({contentType:'text/html',body:'<!doctype html><body></body>'}));await page.goto('/scope-fixture');
 const result=await page.evaluate(async prefix=>{
  const {LocalMusicStore}=await import(prefix+'local-store.js'),{CardProjectStore}=await import(prefix+'card-player/project-store.js');
  const a='account-'+'1'.repeat(64),b='account-'+'2'.repeat(64),sa=new LocalMusicStore({scope:a}),sb=new LocalMusicStore({scope:b}),pa=new CardProjectStore(indexedDB,{scope:a}),pb=new CardProjectStore(indexedDB,{scope:b});
  await sa.put('same-id',new Blob(['A']));await sb.put('same-id',new Blob(['B']));await pa.save({id:'same-project',title:'A'});await pb.save({id:'same-project',title:'B'});
  await sb.delete('same-id');await pb.delete('same-project');
  const old=new LocalMusicStore({scope:'legacy'});await old.put('old-id',new Blob(['legacy']));
  const output={audioA:await(await sa.get('same-id')).text(),projectA:(await pa.get('same-project')).title,audioB:await sb.get('same-id'),projectsB:(await pb.list()).length,legacyRetained:await(await old.get('old-id')).text(),legacyAutoAdopted:Boolean(await sa.get('old-id'))};
  await Promise.all([sa.close(),sb.close(),old.close(),pa.dispose(),pb.dispose()]);return output;
 },prefix);
 expect(result).toEqual({audioA:'A',projectA:'A',audioB:undefined,projectsB:0,legacyRetained:'legacy',legacyAutoAdopted:false});
});
test('legacy UI requires ownership and explicit selection/copy; music/font/project bytes survive and original DB stays intact',async({page})=>{
 await fixture(page,{legacy:true});page.on('dialog',d=>d.accept());await page.locator('[data-data=legacy-preview]').evaluate(n=>n.closest('details').open=true);
 expect(await page.evaluate(async()=>(await library.entries()).length)).toBe(0);expect(await page.evaluate(async()=>(await drafts.list()).length)).toBe(0);await expect(page.locator('[data-data=legacy-projects]')).toHaveText('');
 await page.locator('[data-data=legacy-preview]').click();await expect(page.locator('[data-data=status]')).toContainText('请先确认');
 await page.locator('[data-data=ownership]').check();await page.locator('[data-data=legacy-preview]').click();await expect(page.locator('[data-data=legacy-projects]')).toContainText('项目');
 await page.locator('[data-data=legacy-projects] input').check();await page.locator('[data-data=legacy-copy]').click();await expect(page.locator('[data-data=status]')).toContainText('旧库复制计划已生成');
 expect(await page.evaluate(async()=>(await library.entries()).length)).toBe(0);await page.locator('[data-data=apply]').click();await expect(page.locator('[data-data=status]')).toContainText('恢复完成',{timeout:30000});
 const result=await page.evaluate(async prefix=>{const {LocalMusicStore}=await import(prefix+'local-store.js'),{CardProjectStore}=await import(prefix+'card-player/project-store.js');return {current:await library.count(),drafts:await drafts.count(),old:await new LocalMusicStore({scope:'legacy'}).count(),oldDrafts:await new CardProjectStore(indexedDB,{scope:'legacy'}).count(),audio:(await library.get(app.settings.tracks[0].id)).size,fonts:app.settings.fonts.length};},prefix);
 expect(result).toEqual({current:5,drafts:1,old:5,oldDrafts:1,audio:tone.length,fonts:1});
});
test('storage UI previews then deletes only acknowledged unused resources in actual IDB',async({page})=>{
 await fixture(page);page.on('dialog',d=>d.accept());
 await page.evaluate(async prefix=>{const {MaintenanceJournal}=await import(prefix+'data/journal.js'),journal=new MaintenanceJournal();for(const [id,confirmed]of [['retired-safe',true],['retired-unconfirmed',false]]){await library.put(id,new Blob([id]));await journal.put({id,confirmed},'retired');}await library.put('unknown-orphan',new Blob(['keep']));await journal.put({id:app.settings.tracks[0].id,confirmed:true},'retired');await journal.close();},prefix);
 await page.locator('[data-data=scan]').evaluate(n=>n.closest('details').open=true);await page.locator('[data-data=scan]').click();await expect(page.locator('[data-data=storage-text]')).toContainText('可安全清理预览：1 项');
 expect(await page.evaluate(async()=>Boolean(await library.get('retired-safe')))).toBe(true);await page.locator('[data-data=clean]').click();await expect(page.locator('[data-data=status]')).toContainText('安全清理完成：1 项');
 expect(await page.evaluate(async()=>({removed:await library.get('retired-safe')===undefined,unconfirmed:Boolean(await library.get('retired-unconfirmed')),unknown:Boolean(await library.get('unknown-orphan')),audio:Boolean(await library.get(app.settings.tracks[0].id))}))).toEqual({removed:true,unconfirmed:true,unknown:true,audio:true});
});
test('real quota failure aborts a binary batch and its ownership records without deleting prior bytes',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'stm-v133-quota-'));let context;
 const scope='account-'+'3'.repeat(64),url='http://127.0.0.1:8000/data-quota';
 try {
  context=await chromium.launchPersistentContext(directory,{headless:true,executablePath:process.env.CHROMIUM_PATH});await context.route('**/data-quota',r=>r.fulfill({contentType:'text/html',body:'<!doctype html><body></body>'}));let page=context.pages()[0];await page.goto(url);
  await page.evaluate(async({prefix,scope})=>{const {LocalMusicStore}=await import(prefix+'local-store.js');const s=new LocalMusicStore({scope});await s.put('old',new Blob(['safe']));await s.close();},{prefix,scope});await context.close();
  context=await chromium.launchPersistentContext(directory,{headless:true,executablePath:process.env.CHROMIUM_PATH});await context.route('**/data-quota',r=>r.fulfill({contentType:'text/html',body:'<!doctype html><body></body>'}));page=context.pages()[0];await page.goto(url);
  const cdp=await context.newCDPSession(page);await cdp.send('Storage.overrideQuotaForOrigin',{origin:new URL(url).origin,quotaSize:1});
  const result=await page.evaluate(async({prefix,scope})=>{const {LocalMusicStore}=await import(prefix+'local-store.js');const s=new LocalMusicStore({scope});let error;try{await s.putMany([['small',new Blob(['new'])],['large',new Blob([new Uint8Array(32*1024*1024)])]],{ifAbsent:true,owner:'quota-op'});}catch(e){error=e.name;}return {error,old:await(await s.get('old')).text(),small:Boolean(await s.get('small')),owner:await s.owner('small'),large:Boolean(await s.get('large'))};},{prefix,scope});
  expect(result).toEqual({error:'QuotaExceededError',old:'safe',small:false,owner:null,large:false});
 }finally{await context?.close().catch(()=>{});await rm(directory,{recursive:true,force:true});}
});
