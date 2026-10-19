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
