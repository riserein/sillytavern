import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {checksum,hashText} from '../data/checksum.js';
import {createBackup,inspectBackup} from '../data/backup.js';
import {zipBlob,readZip} from '../data/zip.js';
import {normalizeSettings} from '../core.js';
import {fixture} from './data-fixtures.js';
import {makeRestorePlan} from '../data/restore.js';
test('incremental SHA-256 and CRC match independent known implementations, including empty files',async()=>{
 for(const data of [Buffer.alloc(0),Buffer.from('123456789'),Buffer.alloc(3*1024*1024+7,213)]){
  const sum=await checksum(new Blob([data]));assert.equal(sum.sha256,createHash('sha256').update(data).digest('hex'));
  if(data.toString()==='123456789')assert.equal(sum.crc32,0xcbf43926);
 }
});
test('ZIP binary full backup round-trips all library and project bytes without Base64',async()=>{
 const source=fixture(),result=await createBackup(source),restored=await inspectBackup(result.blob);
 assert.equal(restored.manifest.settings.tracks[0].lyrics,'[00:01]歌词');assert.deepEqual(restored.manifest.settings.playlists[0].characterAvatars,['a.png']);
 assert.equal(restored.manifest.settings.mode,'shuffle');assert.equal(restored.manifest.settings.fontPreset,'custom');
 assert.deepEqual(Buffer.from(await restored.assets[0][1].arrayBuffer()),Buffer.from(await source.entries[0][1].arrayBuffer()));
 assert.equal(await restored.projects[0].assets.fontBlob.text(),'font');assert.equal(restored.projects[0].form['color:background'],'#234567');
 assert.equal(restored.remoteTracks,1);assert(!JSON.stringify(result.manifest).includes('base64,'));
 assert.equal(result.counts.assets,3); // audio/image/font byte dedup, not imaginary loss of references
 assert.equal(result.manifest.resources.length,5);
});
test('backup never exports settings credentials or unrelated host data and redacts known URL tokens',async()=>{
 const source=fixture();source.settings.API_KEY='must-not-export';source.settings.chat=['private-chat'];source.projects[0].cookie='private-cookie';
 source.settings.tracks[1].url='https://audio.example/song.mp3?token=private-token&quality=high';
 const backup=await createBackup(source),json=JSON.stringify(backup.manifest);
 for(const value of ['must-not-export','private-chat','private-cookie','private-token'])assert(!json.includes(value));
 assert(backup.manifest.warnings.length);assert(backup.manifest.settings.tracks[1].url.includes('quality=high'));
});
test('missing assets fail export and corruption fails import before any restore operation',async()=>{
 const source=fixture();await assert.rejects(createBackup({...source,store:{entries:async()=>[]}}),/缺失/);
 const backup=await createBackup(source),entries=await readZip(backup.blob),changed=[];
 for(const [path,row] of entries)changed.push({path,blob:path.startsWith('assets/')?new Blob([new Uint8Array(row.bytes).fill(42)]):row.blob,crc32:row.crc32});
 await assert.rejects(inspectBackup(zipBlob(changed)),/校验失败/);
 const bytes=new Uint8Array(await backup.blob.arrayBuffer());await assert.rejects(inspectBackup(new Blob([bytes.slice(0,-3)])),/ZIP/);
});
test('unsupported manifest versions and duplicate/unsafe ZIP paths are rejected',async()=>{
 const backup=await createBackup(fixture()),entries=await readZip(backup.blob),manifest=JSON.parse(await entries.get('manifest.json').blob.text());manifest.version=99;
 const meta=new Blob([JSON.stringify(manifest)]),m=await checksum(meta),side=new Blob([m.sha256+'\n']),h=await checksum(side);
 const modified=[{path:'manifest.json',blob:meta,crc32:m.crc32},{path:'manifest.sha256',blob:side,crc32:h.crc32},...[...entries].filter(([p])=>p.startsWith('assets/')).map(([path,row])=>({path,...row}))];
 await assert.rejects(inspectBackup(zipBlob(modified)),/版本/);
 assert.throws(()=>zipBlob([{path:'../private',blob:meta,crc32:0}]),/名称/);
 assert.throws(()=>zipBlob([{path:'manifest.json',blob:meta,crc32:0},{path:'manifest.json',blob:meta,crc32:0}]),/名称/);
});
test('hashing and backup verification respect cancellation',async()=>{
 const controller=new AbortController();controller.abort();await assert.rejects(checksum(new Blob(['a']),{signal:controller.signal}),{name:'AbortError'});
 const backup=await createBackup(fixture());await assert.rejects(inspectBackup(backup.blob,{signal:controller.signal}),{name:'AbortError'});
 assert.equal(hashText('abc'),createHash('sha256').update('abc').digest('hex'));
});
test('platform identity/album and referenced default songs survive a backup even when receiving catalog is empty',async()=>{
 const online={id:'platform:openverse:stable-123',platform:'openverse',platformTrackId:'stable-123',title:'Platform song',artist:'Artist',album:'Album',sourceUrl:'https://openverse.org/audio/stable-123',playback:'full'};
 const settings=normalizeSettings({tracks:[{...online,kind:'platform'}],playlists:[{id:'linked',name:'Sources',trackIds:['platform:openverse:stable-123','platform:openverse:builtin-123']}],currentId:'platform:openverse:stable-123'},Date.now(),{version:7,tracks:[{...online,platformTrackId:'builtin-123'}]});
 const result=await createBackup({settings,store:{entries:async()=>[]}}),read=await inspectBackup(result.blob);
 assert.equal(read.manifest.settings.tracks[0].platformTrackId,'stable-123');assert.equal(read.manifest.settings.tracks[0].album,'Album');assert.deepEqual(read.manifest.settings.playlists[0].trackIds,settings.playlists[0].trackIds);
 const restored=await makeRestorePlan({backup:read,current:normalizeSettings({}),store:{entries:async()=>[]},projects:[]});assert.equal(restored.after.tracks.length,2);assert.deepEqual(restored.after.playlists[0].trackIds,settings.playlists[0].trackIds);
});
test('export refuses over-capacity or invalid metadata instead of writing a silently shortened backup',async()=>{
 const source=fixture();source.settings.tracks.push({...source.settings.tracks[0]});await assert.rejects(createBackup(source),/未静默删减/);
});
test('a draft retains its old background original even after the library selects a different background',async()=>{
 const source=fixture(),id=source.settings.backgroundId;source.settings.backgroundId=null;source.entries.find(([key])=>key===id+':original')[1]=new Blob(['old-original'],{type:'image/png'});
 const archive=await createBackup(source),read=await inspectBackup(archive.blob);assert.equal(await read.projects[0].assets.imageOriginalBlob.text(),'old-original');assert.equal(await read.projects[0].assets.imageBlob.text(),'picture');
});
