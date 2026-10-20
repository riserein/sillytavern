import test from 'node:test';
import assert from 'node:assert/strict';
import {createAmbientEngine,normalizeAmbientLibrary,normalizeSoundscape,sceneSoundscape,selectedAmbient,ambientReferences} from '../ambient.js';
const settle=async()=>{for(let i=0;i<12;i++)await Promise.resolve();};
function environment(getBlob=async()=>new Blob(['sound'])){
 class Audio extends EventTarget{constructor(){super();this.paused=true;this.ended=false;this.volume=1;this.currentTime=0;this.attrs=new Map();}set src(value){this.attrs.set('src',value);this.currentTime=0;}get src(){return this.attrs.get('src')||'';}getAttribute(key){return this.attrs.get(key)||null;}removeAttribute(key){this.attrs.delete(key);}load(){}async play(){this.paused=false;this.dispatchEvent(new Event('playing'));}pause(){if(!this.paused){this.paused=true;this.dispatchEvent(new Event('pause'));}}remove(){this.removed=true;}}
 const audios=[],live=new Set(),errors=[],frames=new Map();let now=0,next=0;
 const host={performance:{now:()=>now},requestAnimationFrame:fn=>{frames.set(++next,fn);return next;},cancelAnimationFrame:id=>frames.delete(id)},urls={createObjectURL(){const value='blob:test-'+(++next);live.add(value);return value;},revokeObjectURL:value=>live.delete(value)};
 const engine=createAmbientEngine({createAudio:()=>{const a=new Audio();audios.push(a);return a;},getBlob,host,urls,onError:error=>errors.push(error.message)});
 return {engine,audios,live,errors,frames,tick(ms){now+=ms;const callbacks=[...frames.values()];frames.clear();for(const fn of callbacks)fn(now);}};
}
const row=id=>({id,kind:'local',title:id,loop:true,volume:.25});
test('one lazy auxiliary audio reuses identical sources and never touches a main player',async()=>{
 const env=environment();assert.equal(env.audios.length,0);await env.engine.choose(row('rain'),{play:true,fade:0});const audio=env.engine.audio;audio.currentTime=7;
 await env.engine.choose(row('rain'),{play:true,volume:.4,fade:0});assert.equal(audio.currentTime,7);assert.equal(audio.volume,.4);assert.equal(env.audios.length,1);assert.equal(env.live.size,1);
 env.engine.pause();assert(audio.paused);await env.engine.choose(row('rain'),{play:true,fade:0});assert.equal(audio.currentTime,7);env.engine.dispose();assert(audio.paused);assert.equal(audio.src,'');assert.equal(env.live.size,0);assert.equal(env.frames.size,0);assert.equal(env.engine.audio,null);
});
test('old asynchronous local reads cannot revive a reset or a newer ambient source',async()=>{
 let release;const env=environment(id=>id==='slow'?new Promise(resolve=>release=resolve):Promise.resolve(new Blob(['new'])));
 const pending=env.engine.choose(row('slow'),{play:true,fade:0});await settle();await env.engine.choose(row('new'),{play:true,fade:0});const src=env.engine.audio.src;release(new Blob(['old']));assert.equal(await pending,false);assert.equal(env.engine.audio.src,src);assert.equal(env.live.size,1);
 const second=env.engine.choose(row('slow'),{play:true,fade:0});await settle();env.engine.reset();release(new Blob(['old']));assert.equal(await second,false);assert.equal(env.live.size,0);assert(env.engine.audio.paused);env.engine.dispose();
});
test('fade-out precedes loading the new source and cancellation releases all scheduled frames',async()=>{
 const env=environment();await env.engine.choose(row('a'),{play:true,fade:0});const old=env.engine.audio.src;
 const change=env.engine.choose(row('b'),{play:true,fade:500});await settle();assert.equal(env.engine.audio.src,old);env.tick(250);assert(env.engine.audio.volume>0&&env.engine.audio.volume<.25);env.tick(250);await settle();assert.notEqual(env.engine.audio.src,old);assert.equal(env.live.size,1);env.tick(500);assert.equal(await change,true);assert.equal(env.engine.audio.volume,.25);
 const pending=env.engine.choose(row('c'),{play:true,fade:2000});await settle();env.engine.pause();assert.equal(await pending,false);assert.equal(env.frames.size,0);env.engine.dispose();assert.equal(env.live.size,0);
});
test('late play completion after pause cannot leave ghost audio',async()=>{
 const env=environment();await env.engine.choose(row('a'),{play:false,fade:0});const audio=env.engine.audio;let release;audio.play=()=>new Promise(resolve=>{release=()=>{audio.paused=false;resolve();};});
 const playing=env.engine.choose(row('a'),{play:true,fade:0});await settle();env.engine.pause();release();assert.equal(await playing,false);assert(audio.paused);env.engine.dispose();
});
test('ambient failures are separate and can retry on the same managed channel',async()=>{
 let missing=true;const env=environment(async()=>missing?null:new Blob(['retry']));assert.equal(await env.engine.choose(row('a'),{play:true,fade:0}),false);assert.match(env.errors[0],/主音乐仍可播放/);missing=false;assert.equal(await env.engine.choose(row('a'),{play:true,fade:0}),true);assert.equal(env.audios.length,1);env.engine.dispose();
});
test('scene defaults respect explicit listener off/volume while preserving legacy settings',()=>{
 const scene={ambient:{id:'rain',enabled:true,volume:.3,fade:1000}},defaults=normalizeSoundscape();assert.equal(sceneSoundscape(defaults,scene,[]).enabled,true);
 const personal={...defaults,enabled:false,overrideEnabled:true,volume:.1,overrideVolume:true};const result=sceneSoundscape(personal,scene,[]);assert.equal(result.enabled,false);assert.equal(result.volume,.1);assert.equal(result.fade,1000);
 assert.equal(sceneSoundscape({id:'rain',enabled:true},null,[]).id,'rain');assert.equal(sceneSoundscape(defaults,{id:'silent'},[]).enabled,false);
 const library=normalizeAmbientLibrary([row('rain'),{...row('remote'),kind:'url',url:'https://audio.example/rain.mp3'}]);assert.equal(library.length,2);assert.deepEqual([...ambientReferences(library)],['rain']);assert.equal(selectedAmbient(library,{scenes:[{included:true,ambient:{id:'rain'}},{included:false,ambient:{id:'missing'}}]},{}).length,1);assert.throws(()=>selectedAmbient(library,{scenes:[{ambient:{id:'missing'}}]},{}));
 for(const url of ['http://audio.example/a.mp3','https://localhost/a.mp3','https://192.168.1.1/a.mp3','https://user:pw@audio.example/a.mp3','https://audio.example/a?token=x'])assert.equal(normalizeAmbientLibrary([{id:'a',kind:'url',url}]).length,0);
});
test('portable ambient sources deduplicate bytes and reuse a main recording without serializing it twice',async()=>{
 const {prepareCardPackage}=await import('../card-player/export.js'),{analyzePayload,readScriptPayload,payloadLiteral}=await import('../card-player/quality.js');
 const music=new Blob(['main recording'],{type:'audio/mpeg'}),rain=new Blob(['different environmental sound'],{type:'audio/mpeg'}),image=new Blob(['image'],{type:'image/png'}),blobs=new Map([['song',music],['rain',rain],['rain-copy',rain],['shared',music]]);
 const library=['rain','rain-copy','shared'].map(id=>row(id)),sceneSet={defaultSceneId:'a',scenes:library.map((r,i)=>({id:['a','b','c'][i],name:r.title,trackIds:['song'],ambient:{id:r.id,enabled:true,volume:.25,fade:0}}))};
 const result=await prepareCardPackage({id:'ambient-export',tracks:[{id:'song',kind:'local',title:'main'}],sceneSet,ambientLibrary:library,soundscape:{}},{getBlob:async id=>blobs.get(id),readFallback:async()=>image,probeAudio:async()=>{}});
 assert.equal(result.config.ambientLibrary.length,3);assert.equal(Object.keys(result.config.ambientAssets).length,1);assert.equal(result.config.ambientLibrary[2].sourceTrackId,'song');assert.equal(result.config.ambientLibrary[0].sourceKey,result.config.ambientLibrary[1].sourceKey);
 const analysis=analyzePayload({config:result.config});assert.equal(analysis.rows.filter(r=>r.kind==='ambient-audio').length,1);assert.equal(analysis.embeddedBytes,music.size+rain.size+image.size);assert(analysis.rows.find(r=>r.shared));
 const payload={version:1,config:result.config};assert.equal(readScriptPayload('start('+payloadLiteral(payload)+')').config.ambientLibrary.length,3);
 const broken=structuredClone(payload);delete broken.config.ambientAssets[broken.config.ambientLibrary[0].sourceKey];assert.throws(()=>readScriptPayload('start('+payloadLiteral(broken)+')'),/环境音|音景/);
});
test('missing, unsupported and oversized environmental assets block the entire export before replacement',async()=>{
 const {prepareCardPackage}=await import('../card-player/export.js');const image=new Blob(['image'],{type:'image/png'}),audio=new Blob(['main'],{type:'audio/mpeg'}),input={id:'ambient-failure',tracks:[{id:'main',kind:'local',title:'main'}],ambientLibrary:[row('missing')],soundscape:{id:'missing'}};
 const options={getBlob:async id=>id==='main'?audio:null,readFallback:async()=>image,probeAudio:async()=>{}};await assert.rejects(prepareCardPackage(input,options),/环境音.*缺失/);
 await assert.rejects(prepareCardPackage(input,{...options,getBlob:async id=>id==='main'?audio:new Blob([new Uint8Array(20*1048576+1)],{type:'audio/mpeg'})}),/20 MiB/);
 const original=JSON.stringify(input);await assert.rejects(prepareCardPackage(input,{...options,getBlob:async()=>audio,probeAudio:async src=>{if(src.startsWith('data:audio'))throw new Error('decoder rejected');}}));assert.equal(JSON.stringify(input),original);
});
test('ambient bytes stay inside the original aggregate 30 MiB capacity, even with a controlled encoder',async()=>{
 const {prepareCardPackage}=await import('../card-player/export.js'),image=new Blob(['image'],{type:'image/png'}),blobs=new Map([['sixteen',new Blob([new Uint8Array(16*1048576)],{type:'audio/mpeg'})],['fifteen',new Blob([new Uint8Array(15*1048576)],{type:'audio/mpeg'})]]),rows=[...blobs.keys()].map(row);
 await assert.rejects(prepareCardPackage({id:'same-cap',tracks:[{id:'main',kind:'url',title:'main',url:'https://audio.example/main.mp3'}],ambientLibrary:rows,sceneSet:{scenes:rows.map(r=>({id:r.id,name:r.id,trackIds:['main'],ambient:{id:r.id}}))}},{getBlob:async id=>blobs.get(id),readFallback:async()=>image,probeAudio:async()=>{},encodeBlob:async blob=>blob.type.startsWith('audio/')?'data:audio/mpeg;base64,YQ==':'data:image/png;base64,YQ=='}),/不能超过 30 MB/);
});
test('ZIP restores ambient library, scene references and independent project binaries with complete ID remapping',async()=>{
 const {fixture}=await import('./data-fixtures.js'),{createBackup,inspectBackup}=await import('../data/backup.js'),{makeRestorePlan}=await import('../data/restore.js'),{normalizeSettings}=await import('../core.js'),{referencedAssets}=await import('../asset-retirement.js');
 const source=fixture(),rain='ambient:rain',cover=source.settings.tracks[0].coverId;source.settings.ambientLibrary=[{...row(rain),resourceId:rain,coverId:cover}];source.settings.soundscape=normalizeSoundscape({id:rain,enabled:true,overrideEnabled:true});source.entries.push([rain,new Blob(['rain'],{type:'audio/mpeg'})]);source.settings.roleScenes=[{avatar:'a.png',defaultSceneId:'scene',scenes:[{id:'scene',name:'雨',trackIds:[source.settings.tracks[0].id],ambient:{id:rain,enabled:true,volume:.2,fade:500}}]}];
 source.projects[0].sourceSettings.ambientLibrary=structuredClone(source.settings.ambientLibrary);source.projects[0].sourceSettings.soundscape=structuredClone(source.settings.soundscape);source.projects[0].sourceSettings.sceneSet=structuredClone(source.settings.roleScenes[0]);delete source.projects[0].sourceSettings.sceneSet.avatar;source.projects[0].assets.ambientBlobs={[rain]:source.entries.at(-1)[1],[cover]:source.entries.find(([id])=>id===cover)[1]};
 const archive=await inspectBackup((await createBackup(source)).blob);assert.equal(archive.manifest.settings.ambientLibrary.length,1);assert.equal(await archive.projects[0].assets.ambientBlobs[rain].text(),'rain');
 const plan=await makeRestorePlan({backup:archive,current:source.settings,store:{entries:async()=>source.entries},projects:source.projects,mode:'copy',restorePreferences:true,bindingMap:{'a.png':'b.png'}}),restored=plan.after.ambientLibrary.find(r=>r.id!==rain);assert(restored);assert.notEqual(restored.resourceId,rain);assert.equal(plan.after.roleScenes.find(g=>g.avatar==='b.png').scenes[0].ambient.id,restored.id);assert.equal(plan.after.soundscape.id,restored.id);assert(referencedAssets(plan.after).has(restored.resourceId));assert(plan.assetWrites.some(([id])=>id===restored.resourceId));
 const project=plan.projectWrites[0];assert.equal(project.sourceSettings.ambientLibrary[0].id,restored.id);assert.equal(await project.assets.ambientBlobs[restored.resourceId].text(),'rain');assert.equal(project.sourceSettings.sceneSet.scenes[0].ambient.id,restored.id);
 assert.equal(normalizeSettings(source.settings).tracks.length,2);assert.equal(source.settings.ambientLibrary[0].id,rain);
});
test('unknown ambient references block cleanup instead of treating private bytes as unused',async()=>{
 const {referencedAssets}=await import('../asset-retirement.js'),{referenceGraph}=await import('../data/storage.js'),{unreferencedResourceIds}=await import('../card-player/resource-references.js');
 const shared={tracks:[],ambientLibrary:[{...row('rain'),resourceId:'original-song'}]};assert(referencedAssets(shared).has('original-song'));assert.deepEqual(unreferencedResourceIds(shared,['original-song']),[]);
 const unknown={tracks:[],ambientLibrary:[{...row('rain'),resourceId:{future:'original-song'}}]};assert.equal(referencedAssets(unknown),null);assert(referenceGraph({tracks:[]},[{format:1,tracks:[],sourceSettings:{ambientLibrary:unknown.ambientLibrary}}]).unknown);
});
