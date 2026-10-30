import test from 'node:test';
import assert from 'node:assert/strict';
import {lyricAnchors,normalizeTranslation,translationCandidates,translationTimeline,translationBindingIssues,portableTrackTranslation} from '../translations.js';
import {lyricDocument,serializeLyrics} from '../lyric-document.js';
import {normalizeSettings} from '../core.js';
const original='[ti:原版]\n[00:01]Hello\n[00:03]Good night';
function translation(text=original){const rows=lyricAnchors(text).rows;return {version:1,sourceLanguage:'英语',language:'中文',source:'自译 · 允许此卡分发',sourceLyrics:'你好\n晚安',confirmed:true,distribute:true,rightsConfirmed:true,bindings:rows.map((r,i)=>({lineId:r.id,originalHash:r.originalHash,text:['你好','晚安'][i]||'译文'}))};}
test('TXT translations do not acquire a fabricated line-number match',()=>{
 const candidates=translationCandidates(original,'你好\n晚安');assert(candidates.rows.every(r=>!r.text));assert.equal(translationTimeline({lyrics:original,translation:{...translation(),confirmed:false}}).translationAvailable,false);
});
test('timestamp matching accounts for both file offsets and still requires confirmation',()=>{
 const candidates=translationCandidates('[offset:200]\n[00:01.200]Hello\n[00:03.200]Night','[offset:-300]\n[00:00.700]你好\n[00:02.700]晚安');assert.deepEqual(candidates.rows.map(r=>r.text),['你好','晚安']);assert.equal(candidates.rows[0].sourceTime,.7);
});
test('time-axis edits retain associations even when chronological order changes',()=>{
 const track={lyrics:original,translation:translation()},doc=lyricDocument(original);doc.rows[0].time=5;track.lyrics=serializeLyrics(doc);const rows=translationTimeline(track).lines;assert.deepEqual(rows.map(r=>[r.text,r.translation]),[['Good night','晚安'],['Hello','你好']]);assert.equal(translationBindingIssues(track).length,0);assert.equal(track.translation.sourceLyrics,'你好\n晚安');
});
test('original words or physical-line changes never silently attach translations to different words',()=>{
 const track={lyrics:original.replace('Hello','Different words'),translation:translation()};const data=translationTimeline(track);assert.equal(data.lines[0].translation,undefined);assert.equal(data.lines[1].translation,'晚安');assert.equal(translationBindingIssues(track).length,1);assert.throws(()=>portableTrackTranslation(track),/重新核对/);
});
test('manual TXT associations survive later creation of the original LRC timeline',()=>{
 const text='Hello\nGood night',track={lyrics:text,translation:translation(text)},doc=lyricDocument(text);doc.rows.forEach((r,i)=>r.time=i+1);track.lyrics=serializeLyrics(doc);assert.deepEqual(translationTimeline(track).lines.map(r=>r.translation),['你好','晚安']);
});
test('translation validation bounds fields and makes distribution an explicit licensed choice',()=>{
 const source=translation();assert(normalizeTranslation(source));assert.equal(portableTrackTranslation({lyrics:original,translation:{...source,distribute:false}}),undefined);
 for(const field of ['rightsConfirmed','confirmed'])assert.throws(()=>portableTrackTranslation({lyrics:original,translation:{...source,[field]:false}}),/确认/);
 assert.throws(()=>portableTrackTranslation({lyrics:original,translation:{...source,source:''}}),/署名|来源/);assert.equal(normalizeTranslation({...source,bindings:[...source.bindings,source.bindings[0]]}),null);assert.equal(normalizeTranslation({...source,bindings:[{...source.bindings[0],text:'字'.repeat(2001)}]}),null);
});
test('repeated-stamp expansion is bounded without deleting the original lyric text',()=>{
 const lyrics='[00:01]'.repeat(1100)+'x'.repeat(30000);assert(lyrics.length<50000);assert.throws(()=>lyricDocument(lyrics),/展开超过/);const data=translationTimeline({lyrics});assert.equal(data.synced,false);assert.equal(data.degraded,true);assert.equal(data.lines[0].text,lyrics);
});
test('empty lyrics and unmatched blank lines render safely',()=>{
 for(const lyrics of ['', '\n','[00:01]First\n\n[00:03]Second'])assert.doesNotThrow(()=>translationTimeline({lyrics}));
});
test('binary ZIP preserves normalized translation sources and independent restored track metadata',async()=>{
 const {fixture}=await import('./data-fixtures.js'),{createBackup,inspectBackup}=await import('../data/backup.js'),{makeRestorePlan}=await import('../data/restore.js');const source=fixture();source.settings.tracks[0].lyrics=original;source.settings.tracks[0].translation=translation();source.projects[0].tracks[0]={...source.projects[0].tracks[0],lyrics:original,translation:translation()};const backup=await inspectBackup((await createBackup(source)).blob),plan=await makeRestorePlan({backup,current:source.settings,store:{entries:async()=>source.entries},mode:'copy',restorePreferences:true,bindingMap:{'a.png':'b.png'}});
 const copy=plan.after.tracks.find(t=>t.id!==source.settings.tracks[0].id&&t.kind==='local');assert.deepEqual(copy.translation,normalizeTranslation(source.settings.tracks[0].translation));assert.deepEqual(plan.projectWrites[0].tracks[0].translation,copy.translation);assert.deepEqual(normalizeSettings(source.settings).tracks[0].translation,copy.translation);
});
test('portable packaging carries authorized translation data and omits explicitly local-only translations',async()=>{
 const {prepareCardPackage}=await import('../card-player/export.js'),image=new Blob(['image'],{type:'image/png'}),audio=new Blob(['audio'],{type:'audio/mpeg'}),track={id:'a',kind:'local',title:'a',lyrics:original,translation:translation()},options={getBlob:async()=>audio,readFallback:async()=>image,probeAudio:async()=>{}};
 let result=await prepareCardPackage({id:'translated',tracks:[track]},options);assert.equal(result.config.tracks[0].translation.bindings[0].text,'你好');track.translation.distribute=false;result=await prepareCardPackage({id:'local-translation',tracks:[track]},options);assert.equal(result.config.tracks[0].translation,undefined);track.translation.distribute=true;track.translation.rightsConfirmed=false;await assert.rejects(prepareCardPackage({id:'unlicensed',tracks:[track]},options),/授权|确认/);
});
test('classic exports cannot quietly discard a bilingual recording that needs the shared lyric reader',async()=>{
 const {buildCardExports}=await import('../card-player/export.js');assert.throws(()=>buildCardExports({id:'bilingual-classic',tracks:[{id:'a',title:'a',src:'data:audio/mpeg;base64,YQ==',lyrics:original,translation:translation()}]},'function startCharacterPlayer(){}','test-script'),/双语/);
});
