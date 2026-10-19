import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeSettings, playlistForCharacter, getQueue } from '../core.js';
import { normalizeSceneSet, selectedScene, saveRoleScenes, rememberScene, sceneIssues, sceneAssetReferences, sceneNote } from '../music-scenes.js';
import { referencedAssets } from '../asset-retirement.js';
import { createBackup, inspectBackup } from '../data/backup.js';
import { makeRestorePlan } from '../data/restore.js';
import { normalizeDesign, validateTemplate, designPalette } from '../ui/config.js';
import { readingPalette, contrastRatio, compositeColor } from '../ui/contrast.js';
const tracks = [{id:'a',kind:'url',title:'A',url:'https://example.com/a.mp3'},{id:'b',kind:'local',title:'B'}];
const scene = (id,ids=['a']) => ({id,name:id,description:'',trackIds:ids});

test('old bindings and queues remain intact without scene data', () => {
    const settings=normalizeSettings({tracks,playlists:[{id:'p',name:'旧歌单',trackIds:['b','a'],characterAvatars:['Amber.png']}]});
    assert.deepEqual(settings.roleScenes,[]);assert.equal(selectedScene(settings,'Amber.png',tracks),null);
    assert.deepEqual(getQueue(settings,playlistForCharacter(settings,'Amber.png').id).map(t=>t.id),['b','a']);
});
test('scene settings survive serialization, scope by avatar and keep ordered shared IDs without audio copies', () => {
    const settings=normalizeSettings({tracks});
    saveRoleScenes(settings,'A.png',{defaultSceneId:'rain',scenes:[scene('rain',['b','a','b']),scene('memory')],notes:[{trackId:'a',text:'<img src=x onerror=alert(1)>'}]});
    saveRoleScenes(settings,'B.png',{scenes:[scene('morning',['b'])]});rememberScene(settings,'A.png','memory',tracks);
    const copy=normalizeSettings(JSON.parse(JSON.stringify(settings)));
    assert.equal(selectedScene(copy,'A.png',tracks).id,'memory');assert.equal(selectedScene(copy,'B.png',tracks).id,'morning');
    assert.deepEqual(copy.roleScenes[0].scenes[0].trackIds,['b','a']);assert.equal(copy.tracks.length,2);
    assert.equal(sceneNote(copy.roleScenes[0],'a'),'<img src=x onerror=alert(1)>');assert.equal(sceneNote({...copy.roleScenes[0],showNotes:false},'a'),'');
});
test('missing tracks remain visible as draft issues and personal selection falls back safely', () => {
    const settings=normalizeSettings({tracks,roleScenes:[{avatar:'a',defaultSceneId:'draft',scenes:[scene('draft',['missing']),scene('valid')]}],scenePreferences:[{avatar:'a',sceneId:'gone'}]});
    assert.deepEqual(settings.roleScenes[0].scenes[0].trackIds,['missing']);assert(sceneIssues(settings.roleScenes[0].scenes[0],tracks).length);
    assert.equal(selectedScene(settings,'a',tracks).id,'valid');assert.throws(()=>rememberScene(settings,'a','draft',tracks));
});
test('bounds, duplicate identifiers, Unicode text limits and prototype keys are safe metadata', () => {
    const settings=normalizeSettings({tracks});
    assert.throws(()=>saveRoleScenes(settings,'a',{scenes:Array.from({length:13},(_,i)=>scene(String(i)))}));
    assert.throws(()=>saveRoleScenes(settings,'a',{scenes:[scene('same'),scene('same')]}));
    assert.throws(()=>saveRoleScenes(settings,'a',{scenes:[{...scene('a'),description:'字'.repeat(301)}]}));
    assert.throws(()=>saveRoleScenes(settings,'a',{scenes:[scene('a')],notes:[{trackId:'a',text:'字'.repeat(501)}]}));
    saveRoleScenes(settings,'a',{scenes:[{...scene('__proto__'),description:'🌙'.repeat(300)}],notes:[{trackId:'a',text:'🌙'.repeat(500)}]});
    assert.equal(Array.from(settings.roleScenes[0].notes[0].text).length,500);assert.equal({}.polluted,undefined);
    assert.equal(normalizeSceneSet({scenes:[scene('x'),scene('x')]}).scenes.length,1);
});
test('scene image references protect live resources from retirement without adding audio copies', () => {
    const coverId='cover:11111111-1111-4111-8111-111111111111',backgroundId='background:22222222-2222-4222-8222-222222222222';
    const settings=normalizeSettings({tracks,roleScenes:[{avatar:'a',scenes:[{...scene('s'),coverId,backgroundId}]}]});
    assert.deepEqual([...sceneAssetReferences(settings.roleScenes)],[coverId,backgroundId,backgroundId+':original']);
    const refs=referencedAssets(settings);assert(refs.has('b'));assert(refs.has(coverId));assert(refs.has(backgroundId+':original'));assert(!refs.has('a'));
});
test('portable ZIP contains shared audio once and restores scene/track/role IDs without mutating originals', async () => {
    const settings=normalizeSettings({tracks});saveRoleScenes(settings,'old.png',{defaultSceneId:'memory',scenes:[scene('rain',['b','a']),scene('memory',['b'])],notes:[{trackId:'b',text:'手记'}]});rememberScene(settings,'old.png','rain',tracks);
    const values=new Map([['b',new Blob(['original audio bytes'],{type:'audio/mpeg'})]]),store={entries:async()=>[...values]};
    const backup=await createBackup({settings,store});assert.equal(backup.manifest.resources.length,1);
    const read=await inspectBackup(backup.blob);assert.deepEqual(read.manifest.settings.roleScenes,settings.roleScenes);
    const before=JSON.stringify(settings),plan=await makeRestorePlan({backup:read,current:settings,store,mode:'copy',restorePreferences:true,bindingMap:{'old.png':'new.png'}});
    const group=plan.after.roleScenes.find(g=>g.avatar==='new.png');assert(group);assert.notEqual(group.scenes[0].id,'rain');
    assert.notEqual(group.scenes[0].trackIds[0],'b');assert.equal(group.scenes[0].trackIds[0],group.scenes[1].trackIds[0]);assert.equal(group.notes[0].trackId,group.scenes[0].trackIds[0]);
    assert.equal(plan.after.scenePreferences.find(p=>p.avatar==='new.png').sceneId,group.scenes[0].id);assert.equal(JSON.stringify(settings),before);
    await assert.rejects(makeRestorePlan({backup:read,current:normalizeSettings(),store:{entries:async()=>[]}}),/尚未映射/);
});
test('journal presets and bounded settings share readable palette and template validation',()=>{
    for(const theme of ['journal-parchment','journal-archive','journal-midnight','journal-editorial'])for(const scheme of ['light','dark']){
        const source=designPalette(theme,scheme),p=readingPalette(source);
        for(const bg of [p.surface,...['#000000','#ffffff'].map(b=>compositeColor(p.surface+'e5',b))])for(const ink of [p.body,p.secondary,p.accent])assert(contrastRatio(ink,bg)>=4.5);
    }
    const design=normalizeDesign({layout:'journal',customization:{journalRatio:100,journalTexture:1,journalBinding:'<script>',journalPadding:-4,journalDuration:999}});
    assert.equal(design.customization.journalRatio,.65);assert.equal(design.customization.journalTexture,.08);assert.equal(design.customization.journalPadding,12);assert.equal(design.customization.journalBinding,'stitch');
    assert.equal(validateTemplate({format:'riserein-player-design',version:1,name:'valid',config:design}).config.layout,'journal');
    assert.throws(()=>validateTemplate({format:'riserein-player-design',version:1,name:'bad',config:{...design,customization:{...design.customization,journalDuration:999}}}));
});

test('card export selects complete scenes and carries shared audio once without unselected music or notes',async()=>{
 const {prepareCardPackage}=await import('../card-player/export.js'),{readScriptPayload,payloadLiteral}=await import('../card-player/quality.js');
 const bytes=new Blob(['sound'],{type:'audio/mpeg'}),image=new Blob(['picture'],{type:'image/png'}),id='cover:11111111-1111-4111-8111-111111111111';let reads=0;
 const group=normalizeSceneSet({defaultSceneId:'rain',scenes:[{...scene('rain',['b','a']),coverId:id},scene('memory',['b']),{...scene('private',['c']),included:false}],notes:[{trackId:'b',text:'shared note'},{trackId:'c',text:'private note'}]});
 const result=await prepareCardPackage({id:'test',tracks:[...tracks,{id:'c',kind:'url',title:'C',url:'https://example.com/c.mp3'}],sceneSet:group,appearance:{}},{getBlob:async key=>{if(key==='b'){reads++;return bytes;}if(key===id)return image;},readFallback:async()=>image,probeAudio:async()=>{}});
 assert.equal(reads,1);assert.deepEqual(result.config.tracks.map(t=>t.id),['b','a']);assert.equal(result.config.sceneSet.scenes.length,2);assert.deepEqual(result.config.sceneSet.notes,[{trackId:'b',text:'shared note'}]);assert.equal(Object.keys(result.config.sceneAssets).length,1);
 const decoded=readScriptPayload(payloadLiteral({config:result.config}));assert.deepEqual(decoded.config.sceneSet,result.config.sceneSet);
 const broken=structuredClone(result.config);delete broken.sceneAssets[id];assert.throws(()=>readScriptPayload(payloadLiteral({config:broken})),/图片/);
 assert.equal(group.scenes.length,3);assert.equal(bytes.size,5);
});
test('selected draft, excluded default and missing scene image block export without touching author data',async()=>{
 const {prepareCardPackage}=await import('../card-player/export.js');const image=new Blob(['cover'],{type:'image/png'});
 const prepare=sceneSet=>prepareCardPackage({id:'test',tracks,sceneSet,appearance:{}},{getBlob:async()=>null,readFallback:async()=>image,probeAudio:async()=>{}});
 await assert.rejects(prepare({scenes:[scene('draft',['missing'])]}),/尚未完成/);
 await assert.rejects(prepare({defaultSceneId:'x',scenes:[{...scene('x'),included:false},scene('y')]}),/默认场景/);
 await assert.rejects(prepare({scenes:[{...scene('x'),coverId:'cover:11111111-1111-4111-8111-111111111111'}]}),/封面或背景缺失/);
});
test('draft scene bytes are independent ZIP entries and remapped with project copies',async()=>{
 const {captureProjectResources}=await import('../card-player/project-store.js');const id='background:22222222-2222-4222-8222-222222222222',blob=new Blob(['image'],{type:'image/png'}),settings=normalizeSettings({tracks:[tracks[0]]});
 const set=normalizeSceneSet({scenes:[{...scene('s'),backgroundId:id}],notes:[{trackId:'a',text:'手记'}]});
 const snapshot=await captureProjectResources([tracks[0]],{sceneSet:set},async key=>key.startsWith(id)?blob:null);
 const project={id:'rscp:p',title:'project',format:1,tracks:snapshot.tracks,sourceSettings:{sceneSet:set,uiDesign:normalizeDesign({layout:'journal'})},form:{},assets:{sceneBlobs:snapshot.appearance.sceneBlobs}};
 const store={entries:async()=>[]};const backup=await createBackup({settings,store,projects:[project]});
 assert.equal(backup.manifest.projects[0].assets.sceneBlobs[id].bytes,5);assert(!JSON.stringify(backup.manifest).includes('base64'));
 const read=await inspectBackup(backup.blob);assert.equal(await read.projects[0].assets.sceneBlobs[id].text(),'image');
 const plan=await makeRestorePlan({backup:read,current:settings,store,projects:[project],mode:'copy',restorePreferences:true,bindingMap:{}}),copy=plan.projectWrites[0],sceneCopy=copy.sourceSettings.sceneSet.scenes[0];
 assert.notEqual(sceneCopy.id,'s');assert.notEqual(sceneCopy.backgroundId,id);assert.equal(await copy.assets.sceneBlobs[sceneCopy.backgroundId].text(),'image');assert.equal(copy.sourceSettings.uiDesign.layout,'journal');
});
