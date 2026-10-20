import {expect} from '@playwright/test';
const prefix='/scripts/extensions/third-party/sillytavern/';
export async function fixture(page){
 await page.route('**/scene-fixture',r=>r.fulfill({contentType:'text/html',body:`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="${prefix}ui/player.css"><body></body>`}));await page.goto('/scene-fixture');
 await page.evaluate(async prefix=>{
  const {initialize}=await import(prefix+'index.js'),events=new Map();window.liveURLs=new Set();const create=URL.createObjectURL.bind(URL),revoke=URL.revokeObjectURL.bind(URL);URL.createObjectURL=blob=>{const id=create(blob);liveURLs.add(id);return id;};URL.revokeObjectURL=id=>{liveURLs.delete(id);revoke(id);};
  const tracks=['a','b','c'].map(id=>({id,kind:'url',title:'歌曲 '+id,artist:'合成测试音',url:location.origin+prefix+'card-player/demo-assets/test-tone-'+id+'.mp3',lyrics:'[00:00]第一句\n[00:02]第二句'}));
  window.ctx={extensionSettings:{riserein_music_player:{tracks,transitionDuration:0,roleScenes:[{avatar:'A.png',defaultSceneId:'rain',scenes:[{id:'rain',name:'雨夜书房',trackIds:['a','b']},{id:'memory',name:'旧日回忆',trackIds:['b','a']},{id:'morning',name:'平静清晨',trackIds:['c']}]},{avatar:'B.png',scenes:[{id:'other',name:'角色 B',trackIds:['b']}]}],theme:'night',colorScheme:'dark',surface:'glass',fontPreset:'sans',panelSize:{width:600,height:740}}},characters:[{avatar:'A.png',name:'角色 A'},{avatar:'B.png',name:'角色 B'}],characterId:0,eventTypes:{CHAT_CHANGED:'chat'},eventSource:{on(type,fn){if(!events.has(type))events.set(type,new Set());events.get(type).add(fn);},removeListener(type,fn){events.get(type)?.delete(fn);}},saveSettingsDebounced(){window.saved=structuredClone(this.extensionSettings.riserein_music_player);}};
  window.emitSceneChat=()=>{for(const fn of events.get('chat')||[])fn();};window.sceneListenerCount=()=>[...events.values()].reduce((sum,s)=>sum+s.size,0);window.app=initialize({context:ctx,previewRecovery:true});app.setOpen(true);window.originalAudio=app.audio;
 },prefix);
 await expect.poll(()=>page.evaluate(()=>app.getScene()?.id)).toBe('rain');await expect.poll(()=>page.evaluate(()=>Number.isFinite(app.audio.duration))).toBe(true);
}
