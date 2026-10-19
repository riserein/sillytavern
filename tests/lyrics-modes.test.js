import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeReading } from '../ui/reading.js';
import { flowPosition, normalizeLyricOffsets, effectiveLyricOffset } from '../ui/lyric-timing.js';
import { normalizeVisibility } from '../ui/visibility-state.js';
import { normalizeSettings } from '../core.js';
import { normalizeCardConfig } from '../card-player/config.js';
import { readingPalette, contrastRatio, compositeColor } from '../ui/contrast.js';
import { normalizeDesign } from '../ui/config.js';
import { nativeCardScript } from '../card-player/native-export.js';
test('old reading settings default to flow; modes and next-line preference are bounded',()=>{
 assert.equal(normalizeReading().displayMode,'flow');assert.equal(normalizeReading({displayMode:'bad'}).displayMode,'flow');
 for(const displayMode of ['flow','centered','immersive'])assert.equal(normalizeReading({displayMode,nextLine:false}).displayMode,displayMode);
 assert.equal(normalizeReading({nextLine:false}).nextLine,false);
});
test('flow interpolates between actual timestamps and holds a long instrumental passage',()=>{
 const lines=[{time:0},{time:4},{time:30}],centers=[0,100,200];
 assert.equal(flowPosition(lines,centers,0,2),50);assert.equal(flowPosition(lines,centers,1,10),100);
 assert.equal(flowPosition(lines,centers,1,28.75),150);assert.equal(flowPosition(lines,centers,2,99),200);
 assert.equal(flowPosition(lines,centers,-1,-2),0);
});
test('per-song calibration is clamped, preserves source timestamps and isolated from unrelated songs',()=>{
 const offsets=normalizeLyricOffsets({a:120,b:-750,unknown:1e6,bad:NaN},new Set(['a','b']));
 assert.deepEqual(offsets,{a:120,b:-750});assert.equal(effectiveLyricOffset({id:'a',lyricOffsetMs:300},offsets),120);
 assert.equal(effectiveLyricOffset({id:'c',lyricOffsetMs:1e6},offsets),60000);
 const next=normalizeSettings({tracks:[{id:'a',kind:'local',lyrics:'[00:01]原文',lyricOffsetMs:300}],lyricOffsets:offsets});
 assert.equal(next.tracks[0].lyrics,'[00:01]原文');assert.deepEqual(next.lyricOffsets,{a:120});
});
test('visibility migration cannot introduce unknown states, executable fields or invalid playback positions',()=>{
 assert.deepEqual(normalizeVisibility(),{version:1,state:'normal',edge:'right',snapMode:'snap',resume:null});
 assert.equal(normalizeVisibility({state:'hidden',resume:{id:'a',time:14}}).resume.time,14);
 assert.equal(normalizeVisibility({state:'evil',edge:'top',snapMode:'bad',resume:{id:'a',time:-1}}).state,'normal');
 assert.equal(normalizeVisibility({resume:{id:'a',time:Infinity}}).resume,null);
 assert.equal(normalizeDesign({recipientDisplay:'hidden'}).recipientDisplay,'launcher');
});
test('whole lyric scrim protects every black/white image extreme without line boxes',()=>{
 for(const background of ['#858585','#101921','#fcfcfc','#e23abb'])for(const level of ['standard','clear','high']){
  const p=readingPalette({background,text:background,accent:background},level);
  for(const image of ['#000000','#ffffff']){
   const painted=compositeColor(p.lyricSurface+'e6',image);
   assert(contrastRatio(p.lyrics,painted)>=4.5);assert(contrastRatio(p.current,painted)>=4.5);
  }
 }
});
test('new card payloads carry calibration and author display defaults but never author personal hidden state',()=>{
 const c=normalizeCardConfig({id:'t',tracks:[{id:'a',src:'https://example.com/a.mp3',lyricOffsetMs:400}],recipientDisplay:'docked',reading:{displayMode:'immersive'}});
 assert.equal(c.tracks[0].lyricOffsetMs,400);assert.equal(c.reading.displayMode,'immersive');assert.equal(c.recipientDisplay,'docked');assert.equal(c.visibility,undefined);
 const script=nativeCardScript({config:c},'startNativeCharacterPlayer', 'test');
 assert.deepEqual(script.button,{enabled:true,buttons:[{name:'显示/隐藏角色音乐',visible:true}]});
});

test('binary ZIP keeps new preferences, remaps copied calibration and preserves draft display defaults',async()=>{
 const {createBackup,inspectBackup}=await import('../data/backup.js');const {makeRestorePlan}=await import('../data/restore.js');
 const tracks=[{id:'a',kind:'url',title:'A',url:'https://example.com/a.mp3'}];
 const settings=normalizeSettings({tracks,reading:{displayMode:'immersive'},lyricOffsets:{a:700},visibility:{state:'hidden',resume:{id:'a',time:12}}});
 const store={entries:async()=>[],get:async()=>null};
 const project={id:'rscp:old',title:'旧项目',revision:1,format:1,tracks,form:{'recipient-display':'docked','stm-maker-recipient-display':'docked'},sourceSettings:{reading:settings.reading,lyricOffsets:{a:700},uiDesign:normalizeDesign({recipientDisplay:'docked'})},assets:{}};
 const backup=await inspectBackup((await createBackup({settings,store,projects:[project]})).blob);
 const plan=await makeRestorePlan({backup,current:settings,store,projects:[project],mode:'copy',restorePreferences:true});
 const copied=plan.after.tracks.find(track=>track.id!=='a');assert(copied);assert.equal(plan.after.lyricOffsets[copied.id],700);assert.equal(plan.after.lyricOffsets.a,700);
 assert.equal(plan.after.visibility.resume.id,copied.id);assert.equal(plan.after.reading.displayMode,'immersive');
 assert.equal(plan.projectWrites[0].form['recipient-display'],'docked');assert.equal(plan.projectWrites[0].form['stm-maker-recipient-display'],'docked');assert.equal(plan.projectWrites[0].sourceSettings.lyricOffsets[copied.id],700);
});

test('package preparation transports actual reading, author entry and effective song calibration',async()=>{
 const {prepareCardPackage}=await import('../card-player/export.js');
 const {config}=await prepareCardPackage({id:'defaults',tracks:[{id:'a',kind:'local',title:'A',lyrics:'[00:01]原文'}],appearance:{},reading:{displayMode:'centered',lyricSize:26},recipientDisplay:'docked',lyricOffsets:{a:-300}}, {getBlob:async()=>new Blob(['audio'],{type:'audio/mpeg'}),readFallback:async()=>new Blob(['cover'],{type:'image/png'}),probeAudio:async()=>{}});
 assert.equal(config.reading.displayMode,'centered');assert.equal(config.reading.lyricSize,26);assert.equal(config.recipientDisplay,'docked');assert.equal(config.tracks[0].lyricOffsetMs,-300);assert.equal(config.tracks[0].lyrics,'[00:01]原文');
});
