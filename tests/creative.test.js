import test from 'node:test';
import assert from 'node:assert/strict';
import {lyricDocument,documentIssues,serializeLyrics,stampAtPlayback,playbackAtStamp,lyricHistory,normalizeLyricOverrides,effectiveLyricsTrack} from '../lyric-document.js';
import {dominantColors,coverPalette} from '../ui/cover-colors.js';
import {contrastRatio} from '../ui/contrast.js';
import {normalizeSettings} from '../core.js';
test('time editing retains original words, metadata, offset and multiple stamps without sorting',()=>{
 const source='[ti:标题]\r\n[ar:作者]\r\n[offset:200]\r\n[00:03.00][00:01.20] 第一行  \r\n\r\n[00:01.20]第二行';
 const doc=lyricDocument(source);assert.equal(doc.rows.length,3);doc.rows[0].time=3.1;
 assert.equal(serializeLyrics(doc),'[ti:标题]\r\n[ar:作者]\r\n[offset:200]\r\n[00:03.100][00:01.20] 第一行  \r\n\r\n[00:01.20]第二行');
 assert(documentIssues(doc).some(i=>i.message.includes('乱序')));assert(documentIssues(doc).some(i=>i.message.includes('重复')));
 assert.equal(doc.original,source);
});
test('sequential TXT timing rejects incomplete, invalid and out of range drafts',()=>{
 const doc=lyricDocument('第一句\n第二句');doc.rows[0].time=1;assert(documentIssues(doc).some(i=>i.kind==='error'));
 doc.rows[1].time=2;assert.equal(serializeLyrics(doc),'[00:01.000]第一句\n[00:02.000]第二句');
 assert.equal(documentIssues(doc).length,0);assert(documentIssues(doc,{duration:1.5}).some(i=>i.kind==='error'));
 for(const text of ['[-00:02]负数','[00:65]无效','[offset:bad]\n歌词'])assert(documentIssues(lyricDocument(text)).some(i=>i.kind==='error'));
 assert.throws(()=>lyricDocument('字'.repeat(50001)));
});
test('file offset and personal calibration round trip against the same audio clock',()=>{
 const doc=lyricDocument('[offset:450]\n[00:01]a');const stamp=stampAtPlayback(12.5,doc,700);assert.equal(stamp,12.25);assert.equal(playbackAtStamp(stamp,doc,700),12.5);
});
test('forty undo states and branching redo preserve independent drafts',()=>{
 const doc=lyricDocument('歌词'),history=lyricHistory(doc);for(let i=1;i<=40;i++){doc.rows[0].time=i;history.push(doc);}for(let i=39;i>=0;i--)assert.equal(history.undo().rows[0].time,i||null);
 assert(!history.canUndo);assert.equal(history.redo().rows[0].time,1);doc.rows[0].time=99;history.push(doc);assert(!history.canRedo);
});
test('personal lyrics do not mutate author data and survive settings normalization',()=>{
 const track={id:'a',kind:'local',title:'a',lyrics:'作者',lyricOriginal:'原文'};const settings=normalizeSettings({tracks:[track],lyricOverrides:[{trackId:'a',lyrics:'个人',original:'作者'},{trackId:'missing',lyrics:'x'}]});
 assert.equal(effectiveLyricsTrack(settings.tracks[0],settings.lyricOverrides).lyrics,'个人');assert.equal(track.lyrics,'作者');assert.equal(settings.tracks[0].lyricOriginal,'原文');assert.equal(settings.lyricOverrides.length,1);
 assert.equal(normalizeLyricOverrides([{trackId:'a',lyrics:'字'.repeat(50001)}]).length,0);
});
const base={background:'#1c302b',surface:'#253b34',text:'#e9efec',muted:'#9dac9d',accent:'#f7d395',border:'#6c827a'};
test('cover sampling is deterministic, ignores transparent pixels and keeps locked author colors',()=>{
 const pixels=new Uint8ClampedArray([250,120,40,255,248,123,43,255,0,0,255,0,20,80,120,255]);const colors=dominantColors(pixels);assert.equal(colors[0],'#f97a2a');
 for(const mode of ['soft','strong']){const next=coverPalette(base,colors,mode);assert(contrastRatio(next.text,next.background)>=6.98);assert(contrastRatio(next.muted,next.background)>=4.48);assert(contrastRatio(next.accent,next.background)>=4.48);assert.equal(coverPalette(base,colors,mode,{background:base.background,accent:base.accent}).accent,base.accent);}
 assert.deepEqual(coverPalette(base,colors),base);assert.deepEqual(coverPalette(base,null,'strong'),base);
});

test('ZIP keeps lyric originals and remaps personal edits when restoring independent track copies',async()=>{
 const {fixture}=await import('./data-fixtures.js'),{createBackup,inspectBackup}=await import('../data/backup.js'),{makeRestorePlan}=await import('../data/restore.js');
 const source=fixture(),id=source.settings.tracks[0].id;source.settings.tracks[0].lyricOriginal='[ti:原版]\n原文';source.settings.lyricOverrides=[{trackId:id,lyrics:'[00:01.000]个人版',original:'原版'}];
 const backup=await inspectBackup((await createBackup(source)).blob),plan=await makeRestorePlan({backup,current:source.settings,store:{entries:async()=>source.entries,get:async key=>source.entries.find(([id])=>id===key)?.[1]},projects:[],mode:'copy',restorePreferences:true,bindingMap:{'a.png':'b.png'}});
 const edit=plan.after.lyricOverrides.find(row=>row.lyrics.includes('个人版')&&row.trackId!==id);assert(edit);assert(plan.after.tracks.some(track=>track.id===edit.trackId&&track.lyricOriginal.includes('[ti:原版]')));
});
