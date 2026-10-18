import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeDesign, normalizeDesigns, normalizeRoleDesigns, validateTemplate, createDesignHistory, randomColors, designReferences } from '../ui/config.js';
import {normalizeSettings} from '../core.js';
import {createBackup,inspectBackup} from '../data/backup.js';
import {makeRestorePlan} from '../data/restore.js';
import {referenceGraph} from '../data/storage.js';
test('design dimensions are independent, old settings fall back to night and unsafe parameters never become CSS',()=>{
 const old={theme:'forest',surface:'glass',fontPreset:'custom'};const raw=structuredClone(old),design=normalizeDesign();assert.equal(design.layout,'night');assert.equal(design.launcher,'vinyl');assert.deepEqual(raw,old);
 const result=normalizeDesign({layout:'vinyl',theme:'mist-blue',launcher:'capsule',customization:{coverSize:999,cornerRadius:-9,opacity:NaN,colors:{accent:'red;background:url(javascript:x)'},animationLevel:'rich'}});
 assert.equal(result.layout,'vinyl');assert.equal(result.theme,'mist-blue');assert.equal(result.launcher,'capsule');assert.equal(result.customization.coverSize,1.15);assert.equal(result.customization.cornerRadius,0);assert.equal(result.customization.colors.accent,null);assert.equal(result.customization.animationLevel,'rich');
 assert.equal(normalizeDesign({layout:'cd',uiVersion:99}).layout,'night');
});
test('template files reject unknown versions, unsupported layouts and invalid values without changing the caller',()=>{
 const config=normalizeDesign({layout:'crystal'}),file={format:'riserein-player-design',version:1,name:'<img onerror=alert(1)>',config};const before=JSON.stringify(file);assert.equal(validateTemplate(file).config.layout,'crystal');assert.equal(JSON.stringify(file),before);
 for(const mutation of [{version:2},{config:{...config,layout:'radio'}},{config:{...config,customization:{...config.customization,opacity:400}}},{icon:'data:image/svg+xml,<svg onload=alert(1) />'}])assert.throws(()=>validateTemplate({...file,...mutation}));
 const injected=validateTemplate({...file,script:'alert(1)',config:{...config,css:'body{display:none}'}});assert.equal(injected.script,undefined);assert.equal(injected.config.css,undefined);
});
test('history snapshots are independent, bound memory and discard redo after a branch',()=>{
 const history=createDesignHistory({});history.push({layout:'vinyl'});history.push({layout:'cassette'});assert.equal(history.undo().layout,'vinyl');assert.equal(history.redo().layout,'cassette');history.undo();history.push({layout:'pure'});assert.equal(history.canRedo,false);
 const snapshot=history.read();snapshot.layout='crystal';assert.equal(history.read().layout,'pure');for(let i=0;i<80;i++)history.push({layout:i%2?'vinyl':'cassette'});let count=0;while(history.canUndo){history.undo();count++;}assert.equal(count,49);
});
test('named and role designs retain separate IDs and live icon references; locked colors stay fixed',()=>{
 const icon='cover:00000000-0000-4000-8000-000000000000',config=normalizeDesign({customization:{iconId:icon}}),row={id:'design:00000000-0000-4000-8000-000000000000',name:'test',config};
 assert.equal(normalizeDesigns([row,row]).length,1);assert.equal(normalizeRoleDesigns([{avatar:'a.png',config},{avatar:'a.png',config}]).length,1);assert.deepEqual([...designReferences({designs:[row]})],[icon]);
 assert.equal(randomColors({accent:'#123456'},new Set(['accent']),()=>.1).accent,'#123456');
});
test('binary ZIP preserves template icons and role designs; copy restore remaps assets and role identity without touching the source',async()=>{
 const id='cover:00000000-0000-4000-8000-000000000000',config=normalizeDesign({layout:'vinyl',launcher:'custom',customization:{iconId:id}}),settings=normalizeSettings({uiDesign:config,designs:[{id:'design:00000000-0000-4000-8000-000000000000',name:'Walnut',config}],roleDesigns:[{avatar:'old.png',config}]}),blob=new Blob([Uint8Array.from([137,80,78,71,13,10,26,10])],{type:'image/png'});
 const source=JSON.stringify(settings),store={entries:async()=>[[id,blob]],get:async key=>key===id?blob:undefined};
 const backup=await inspectBackup((await createBackup({settings,store})).blob);assert.equal(backup.assets.length,1);assert.deepEqual(backup.manifest.settings.uiDesign,config);
 const plan=await makeRestorePlan({backup,current:normalizeSettings(),store:{entries:async()=>[]},mode:'copy',restorePreferences:true,bindingMap:{'old.png':'new.png'}});
 const restored=plan.after.uiDesign.customization.iconId;assert.notEqual(restored,id);assert.equal(plan.after.designs[0].config.customization.iconId,restored);assert.equal(plan.after.roleDesigns[0].avatar,'new.png');assert.equal(plan.assetWrites[0][0],restored);assert.equal(await plan.assetWrites[0][1].text(),await blob.text());assert.equal(JSON.stringify(settings),source);
});
test('unused saved designs and authoring drafts protect their referenced icon bytes from cleanup',()=>{
 const id='cover:00000000-0000-4000-8000-000000000000',config=normalizeDesign({launcher:'custom',customization:{iconId:id}}),settings=normalizeSettings({});
 const graph=referenceGraph(settings,[{format:1,tracks:[],sourceSettings:{uiDesign:config}}]);assert(graph.refs.has(id));assert.equal(graph.unknown,false);
});
