import {test,expect} from '@playwright/test';
import {readFile,mkdir,writeFile} from 'node:fs/promises';

const script=JSON.parse(await readFile(new URL('../card-player/dist/demo.tavern-helper.json',import.meta.url),'utf8'));
const source=script.content;
const rootSelector='[data-riserein-card-player]';
const cards=new Map();
const snapshots=[];

async function selectCard(page,avatar){await page.evaluate(async avatar=>{const {selectCharacterById}=await import('/script.js');const c=SillyTavern.getContext();await selectCharacterById(c.characters.findIndex(card=>card.avatar===avatar));},avatar);}
async function createCard(page,label,withPlayer=true){
 const name=`RSCP_Test_${label}_${crypto.randomUUID().slice(0,8)}`;
 const avatar=await page.evaluate(async({name,script,withPlayer})=>{await TavernHelper.createCharacter(name,{description:'Independent card-player lifecycle fixture. No reference-card content.',first_messages:['Fixture opening one.','Fixture opening two.'],extensions:{tavern_helper:{scripts:withPlayer?[{...script,enabled:true}]:[],variables:{}}}});return SillyTavern.getContext().characters.find(card=>card.name===name).avatar;},{name,script,withPlayer});
 cards.get(page).push({name,avatar});return avatar;
}
async function acceptEnable(page){await page.getByText(/^(确认|Confirm)$/,{exact:true}).last().click();await expect(page.locator(rootSelector)).toHaveCount(1,{timeout:30000});}
async function remember(page){return page.locator(rootSelector).evaluate(root=>{const api=root.__risereinPlayer;window.__cardOriginal={root,api,audio:api.audio,src:api.audio.src,title:root.shadowRoot.querySelector('.title').textContent,frame:document.querySelector(`iframe[id$="${api.scriptId}"]`)};return{time:api.audio.currentTime,src:api.audio.src,resources:api.resourceCounts};});}
async function continuous(page,floor){
 await expect(page.locator(rootSelector)).toHaveCount(1);
 expect(await page.evaluate(()=>{const r=window.__cardOriginal,live=document.querySelector('[data-riserein-card-player]');return live===r.root&&live.__risereinPlayer.audio===r.audio&&r.audio.src===r.src&&live.shadowRoot.querySelector('.title').textContent===r.title&&document.querySelector(`iframe[id$="${r.api.scriptId}"]`)===r.frame&&!r.audio.paused;})).toBe(true);
 await expect.poll(()=>page.locator(rootSelector+' audio').evaluate(audio=>audio.currentTime)).toBeGreaterThanOrEqual(floor);
}
async function start(page){await page.getByRole('button',{name:'播放角色音乐',exact:true}).click();await expect.poll(()=>page.locator(rootSelector+' audio').evaluate(audio=>audio.currentTime)).toBeGreaterThan(.2);await page.locator(rootSelector+' .seek').fill('8');await page.locator(rootSelector+' .seek').dispatchEvent('input');await expect.poll(()=>page.locator(rootSelector+' audio').evaluate(audio=>audio.currentTime)).toBeGreaterThanOrEqual(8);return remember(page);}
async function gone(page){await expect(page.locator(rootSelector)).toHaveCount(0);expect(await page.evaluate(()=>{const old=window.__cardOriginal;return old.api.disposed&&old.audio.paused&&!old.audio.hasAttribute('src')&&!old.audio.isConnected&&!old.root.isConnected&&Object.values(old.api.resourceCounts).every(value=>value===0);})).toBe(true);}
async function home(page){await page.evaluate(async()=>{const {closeCurrentChat}=await import('/script.js');await closeCurrentChat();});}
async function shot(page,name){await mkdir('docs/card-player',{recursive:true});await page.screenshot({path:`docs/card-player/${name}.png`,fullPage:false});}
async function revealHelper(page){
 if(!await page.locator('#rm_extensions_block').isVisible())await page.locator('#extensions-settings-button .drawer-toggle').click();
 const panel=page.locator('#tavern_helper');if(!await panel.locator('.inline-drawer-content').isVisible())await panel.locator('.inline-drawer-toggle').click();
 await panel.getByText(/^(脚本|Script)$/,{exact:true}).first().click();
}

test.beforeAll(async()=>{await mkdir('docs/card-player',{recursive:true});await writeFile('docs/card-player/browser-validation.json',JSON.stringify({status:'running',results:[]})+'\n');});

test.beforeEach(async({page})=>{
 test.setTimeout(120000);page.setDefaultTimeout(15000);cards.set(page,[]);
 await page.route('**/api/settings/get',async route=>{
  const response=await route.fetch(),body=await response.json(),settings=JSON.parse(body.settings);settings.firstRun=false;settings.main_api='kobold';settings.api_server='http://fixture.invalid';settings.extension_settings||={};
  settings.extension_settings.disabledExtensions=['third-party/sillytavern'];
  settings.extension_settings.tavern_helper={optimize:{disable_incompatible_option:false,force_recommended_worldbook_global_settings:false},script:{enabled:{global:false,characters:[],presets:[]},popuped:{characters:[],presets:[]}}};body.settings=JSON.stringify(settings);await route.fulfill({response,json:body});
 });
 await page.goto('/');await page.waitForFunction(()=>!!window.TavernHelper,{},{timeout:30000});await page.waitForFunction(()=>!document.getElementById('preloader'));await page.unroute('**/api/settings/get');await home(page);
 await expect(page.locator('#stm-player')).toHaveCount(0); // Prove independence from the full plugin.
 expect(await page.evaluate(()=>TavernHelper.getTavernHelperVersion())).toBe('4.11.3');
});
test.afterEach(async({page},info)=>{
 try {
  await home(page);
  for(const {avatar} of cards.get(page)||[]) {
   if(!avatar.startsWith('RSCP_Test_'))throw new Error('Refusing to delete a non-fixture character.');
   await page.evaluate(async avatar=>{const response=await fetch('/api/characters/delete',{method:'POST',headers:SillyTavern.getContext().getRequestHeaders(),body:JSON.stringify({avatar_url:avatar,delete_chats:true})});if(!response.ok)throw new Error('Fixture cleanup failed');},avatar);
  }
  snapshots.push({name:info.title,status:info.status,cleanup:'passed'});
 } catch(error) { snapshots.push({name:info.title,status:'cleanup-failed',error:error.message}); throw error; }
});
test.afterAll(async()=>{await mkdir('docs/card-player',{recursive:true});await writeFile('docs/card-player/browser-validation.json',JSON.stringify({status:snapshots.length===3&&snapshots.every(result=>result.status==='passed'&&result.cleanup==='passed')?'passed':'incomplete-or-failed',tavernHelperVersion:'4.11.3',tavernHelperRevision:'a0f3a180344cff38a4b3e75041d5a94380b877d6',sillyTavernVersion:'1.19.0',fullPluginEnabled:false,musicMocked:false,music:'embedded original synthetic MP3',llmResponse:'deterministic local test fixture; no real AI service',mobile:'Chromium touch/viewport emulation, not physical hardware',results:snapshots},null,2)+'\n');});

test('real character script keeps its host audio across greetings, messages, AI swipes, edits, regeneration and chats',async({page})=>{
 const a=await createCard(page,'A'),b=await createCard(page,'B',false);await selectCard(page,a);await acceptEnable(page);for(const title of ['测试曲一 · 低音','测试曲二 · 中音','测试曲三 · 高音']){await page.getByRole('button',{name:`选择测试曲：${title}`,exact:true}).click();await expect.poll(()=>page.locator(rootSelector+' audio').evaluate(audio=>audio.currentTime)).toBeGreaterThan(.1);}await page.getByRole('button',{name:'暂停角色音乐',exact:true}).click();const initial=await start(page);
 // Collapse the floating panel before using chat controls underneath; music must keep its identity.
 await page.getByRole('button',{name:'收起角色播放器',exact:true}).click();await continuous(page,initial.time);
 await page.evaluate(async()=>{const {swipe_right}=await import('/script.js');await swipe_right();});await expect(page.locator('#chat .mes_text').last()).toContainText('Fixture opening two');await continuous(page,initial.time);
 await page.evaluate(async()=>{await TavernHelper.createChatMessages([{role:'user',message:'Lifecycle user fixture.'},{role:'assistant',message:'AI reply variant one.'}]);});await continuous(page,initial.time);
 await page.evaluate(async()=>{const context=SillyTavern.getContext();const id=context.chat.length-1;await TavernHelper.setChatMessages([{message_id:id,swipe_id:0,swipes:['AI reply variant one.','AI reply variant two.']}]);const {swipe_right}=await import('/script.js');await swipe_right();});await expect(page.locator('#chat .mes_text').last()).toContainText('AI reply variant two');await continuous(page,initial.time);
 const last=page.locator('#chat .mes').last();await last.locator('.mes_edit').click();await last.locator('.edit_textarea').fill('Edited AI reply.');await last.locator('.mes_edit_done').click();await expect(last.locator('.mes_text')).toContainText('Edited AI reply');await continuous(page,initial.time);
 // Real Generate/regenerate path; only the LLM server response/token counts are test fixtures.
 await page.route('**/api/backends/kobold/generate',route=>route.fulfill({json:{results:[{text:'Regenerated lifecycle response.'}]}}));
 await page.route('**/api/tokenizers/**',route=>route.fulfill({json:{count:5,ids:[1,2,3,4,5]}}));
 await page.evaluate(async()=>{const {setOnlineStatus,Generate}=await import('/script.js');setOnlineStatus('Lifecycle fixture');await Generate('regenerate');});await expect(page.locator('#chat .mes_text').last()).toContainText('Regenerated lifecycle response');await continuous(page,initial.time);
 const firstChat=await page.evaluate(()=>SillyTavern.getContext().chatId);expect(firstChat).toBeTruthy();
 await page.evaluate(async()=>{const {saveChat,openCharacterChat}=await import('/script.js');await saveChat({force:true});await openCharacterChat('RSCP_Test_Second_'+crypto.randomUUID());});expect(await page.evaluate(()=>SillyTavern.getContext().chatId)).not.toBe(firstChat);await continuous(page,initial.time);
 await page.evaluate(async file=>{const {openCharacterChat}=await import('/script.js');await openCharacterChat(file);},firstChat);expect(await page.evaluate(()=>SillyTavern.getContext().chatId)).toBe(firstChat);await expect(page.locator('#chat .mes_text').last()).toContainText('Regenerated lifecycle response');await continuous(page,initial.time);
 await page.getByRole('button',{name:'展开角色音乐播放器',exact:true}).click();await continuous(page,initial.time);await shot(page,'desktop');await selectCard(page,b);await gone(page);
 await selectCard(page,a);await expect(page.locator(rootSelector)).toHaveCount(1);expect(await page.locator(rootSelector).evaluate(root=>root.__risereinPlayer.audio!==window.__cardOriginal.audio&&root.__risereinPlayer.audio.paused)).toBe(true);
 const baseline=await page.evaluate(()=>SillyTavern.getContext().eventSource.events.chat_id_changed.length); // A's one live lifecycle listener.
 for(let i=0;i<4;i++){await remember(page);await selectCard(page,b);await gone(page);await selectCard(page,a);await expect(page.locator(rootSelector)).toHaveCount(1);expect(await page.evaluate(()=>SillyTavern.getContext().eventSource.events.chat_id_changed.length)).toBe(baseline);}
 await remember(page);await home(page);await gone(page);
});

test('real script import, disable/re-enable, duplicate execution and PNG card export/reimport retain an independent working player',async({page})=>{
 const a=await createCard(page,'Import',false);await selectCard(page,a);await revealHelper(page);
 const chooser=page.waitForEvent('filechooser');await page.locator('#tavern_helper').getByText(/^(导入|Import)$/,{exact:true}).click();
 // The helper asks for the target library before opening the file picker.
 await page.getByRole('radio',{name:/^(角色脚本库|Character Script Library)$/,exact:true}).check();
 await page.getByText(/^(确认|Confirm)$/,{exact:true}).last().click();
 const file=await chooser;await file.setFiles({name:'riserein-lifecycle.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(script))});
 const item=page.locator('#tavern_helper [data-type=script]').filter({hasText:script.name});await expect(item).toHaveCount(1);
 await page.locator('#tavern_helper label[for="角色脚本-script-enable-toggle"],#tavern_helper label[for="Character Script-script-enable-toggle"]').click();
 await item.locator('.fa-toggle-off').click();await expect(page.locator(rootSelector)).toHaveCount(1,{timeout:30000});await start(page);await page.locator(rootSelector+' .volume input').fill('31');await page.locator(rootSelector+' .volume input').dispatchEvent('input');await shot(page,'helper-enabled');
 const savedId=await page.locator(rootSelector).getAttribute('data-script-id');
 const iframe=page.frames().find(frame=>frame.name().endsWith(savedId));await iframe.evaluate(source=>(0,eval)(source),source);await continuous(page,8);await expect(page.locator(rootSelector)).toHaveCount(1);
 await revealHelper(page);await item.locator('.fa-toggle-on').click();await gone(page);await item.locator('.fa-toggle-off').click();await expect(page.locator(rootSelector)).toHaveCount(1);await remember(page);
 const bytes=await page.evaluate(async avatar=>{const response=await fetch('/api/characters/export',{method:'POST',headers:SillyTavern.getContext().getRequestHeaders(),body:JSON.stringify({avatar_url:avatar,format:'png'})});if(!response.ok)throw new Error('Real PNG export failed');return Array.from(new Uint8Array(await response.arrayBuffer()));},a);
 await home(page);await gone(page);
 const imported=await page.evaluate(async bytes=>{const form=new FormData();form.append('avatar',new File([new Uint8Array(bytes)],'RSCP_Test_Export.png',{type:'image/png'}));form.append('file_type','png');const headers=SillyTavern.getContext().getRequestHeaders();delete headers['Content-Type'];const response=await fetch('/api/characters/import',{method:'POST',headers,body:form});if(!response.ok)throw new Error('Real PNG import failed');const data=await response.json();const {getCharacters}=await import('/script.js');await getCharacters();return data.file_name+'.png';},bytes);
 cards.get(page).push({name:await page.evaluate(avatar=>SillyTavern.getContext().characters.find(c=>c.avatar===avatar).name,imported),avatar:imported});
 expect(imported).not.toBe(a);await selectCard(page,imported);await acceptEnable(page);await start(page);expect(await page.locator(rootSelector+' audio').evaluate(audio=>audio.volume)).toBe(.2);const carried=await page.evaluate(()=>TavernHelper.getScriptTrees({type:'character'})[0]);expect(carried.content).toBe(source);expect(carried.export_with).toEqual({data:true,button:true});await shot(page,'reimported');
});

test.describe('phone',()=>{
 test.use({viewport:{width:375,height:844},isMobile:true,hasTouch:true});
 test('mobile character lifecycle reuses audio during chat/swipe and removes all resources on exit',async({page})=>{
 await page.setViewportSize({width:375,height:844});const a=await createCard(page,'Mobile'),b=await createCard(page,'MobileB',false);await selectCard(page,a);await acceptEnable(page);const before=await start(page);
 await page.getByRole('button',{name:'收起角色播放器',exact:true}).tap();await expect(page.getByRole('button',{name:'展开角色音乐播放器',exact:true})).toBeVisible();await continuous(page,before.time);
 await page.getByRole('button',{name:'展开角色音乐播放器',exact:true}).tap();await page.evaluate(async()=>{const {swipe_right,openCharacterChat}=await import('/script.js');await swipe_right();await openCharacterChat('RSCP_Test_Mobile_'+crypto.randomUUID());});await continuous(page,before.time);
 const bounds=await page.locator(rootSelector).boundingBox();expect(bounds.x).toBeGreaterThanOrEqual(0);expect(bounds.x+bounds.width).toBeLessThanOrEqual(375);expect(bounds.y).toBeGreaterThanOrEqual(0);expect(bounds.y+bounds.height).toBeLessThanOrEqual(844);await shot(page,'mobile');
 await selectCard(page,b);await gone(page);await selectCard(page,a);await expect(page.locator(rootSelector)).toHaveCount(1);await remember(page);await home(page);await gone(page);
});
});
