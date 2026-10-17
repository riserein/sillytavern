import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture} from './data-fixtures.js';
import {createBackup,inspectBackup} from '../data/backup.js';
import {makeRestorePlan,applyRestore,recoverRestore,settingsHash} from '../data/restore.js';
import {normalizeSettings} from '../core.js';
function environment(source={settings:normalizeSettings({}),entries:[],projects:[]}){
 const values=new Map(source.entries),owners=new Map(),rows=new Map(source.projects.map(p=>[p.id,structuredClone(p)])),operations=new Map();
 return {settings:structuredClone(source.settings),store:{entries:async()=>[...values],get:async id=>values.get(id),owner:async id=>owners.get(id),putMany:async(entries,{ifAbsent,owner})=>{
  if(ifAbsent&&entries.some(([id])=>values.has(id)))throw new Error('conflict');for(const [id,blob] of entries){values.set(id,blob);owners.set(id,owner);}
 },deleteMany:async ids=>{for(const id of ids){values.delete(id);owners.delete(id);}}},projects:{list:async()=>[...rows.values()],get:async id=>rows.get(id),putNew:async projects=>{
  if(projects.some(p=>rows.has(p.id)))throw new Error('project conflict');for(const p of projects)rows.set(p.id,{...p,revision:1});
 },delete:async(id,revision)=>{assert.equal(rows.get(id).revision,revision);rows.delete(id);}},journal:{put:async op=>operations.set(op.id,structuredClone(op)),list:async()=>[...operations.values()]},values,owners,rows,operations};
}
const backup=async()=>inspectBackup((await createBackup(fixture())).blob);
test('restore plans preserve originals, deduplicate actual audio bytes, map bindings and keep permanent order',async()=>{
 const source=fixture(),imported=await backup(),env=environment(source);
 const plan=await makeRestorePlan({backup:imported,current:env.settings,store:env.store,projects:await env.projects.list(),mode:'merge',bindingMap:{'a.png':'b.png'}});
 assert.equal(plan.summary.duplicateAudio,1);assert.equal(plan.summary.tracksAdded,0);assert.equal(plan.summary.projectConflicts,1);assert.equal(plan.projectWrites.length,1);assert.notEqual(plan.projectWrites[0].id,source.projects[0].id);
 assert.deepEqual(plan.after.playlists[0].trackIds,source.settings.playlists[0].trackIds);
 assert.equal(settingsHash(env.settings),settingsHash(source.settings));
 const empty=environment(),fresh=await makeRestorePlan({backup:imported,current:empty.settings,store:empty.store,projects:[],restorePreferences:true,bindingMap:{'a.png':'b.png'}});
 assert.deepEqual(fresh.after.playlists[0].characterAvatars,['b.png']);assert.equal(fresh.after.mode,'shuffle');
 assert(fresh.assetWrites.some(([id])=>id===fresh.after.backgroundId+':original'));
});
test('missing mode repairs absent bytes without overwriting existing files and skips project conflicts',async()=>{
 const source=fixture(),env=environment({...source,entries:source.entries.slice(1)}),plan=await makeRestorePlan({backup:await backup(),current:env.settings,store:env.store,projects:source.projects,mode:'missing'});
 assert.equal(plan.assetWrites.length,1);assert.equal(plan.assetWrites[0][0],source.settings.tracks[0].id);assert.equal(plan.projectWrites.length,0);assert.equal(plan.summary.skippedProjects,1);
});
test('independent copy uses new IDs, and capacity overflow refuses before writing',async()=>{
 const source=fixture(),env=environment(source),imported=await backup();
 const plan=await makeRestorePlan({backup:imported,current:env.settings,store:env.store,projects:source.projects,mode:'copy'});
 assert.equal(plan.after.tracks.length,4);assert.equal(plan.after.playlists.length,2);assert.notEqual(plan.after.tracks[2].id,source.settings.tracks[0].id);
 env.settings.tracks=Array.from({length:200},(_,i)=>({id:'url'+i,kind:'url',title:'song',url:`https://audio.example/${i}.mp3`}));
 await assert.rejects(makeRestorePlan({backup:imported,current:env.settings,store:env.store,projects:[],mode:'copy'}),/超过现有限制/);
});
test('successful restore publishes only after staging and verifies references',async()=>{
 const env=environment(),plan=await makeRestorePlan({backup:await backup(),current:env.settings,store:env.store,projects:[],restorePreferences:true});
 let published=false;
 const result=await applyRestore({...env,plan,commitSettings:async after=>{assert(env.values.size>0);assert(env.rows.size>0);Object.assign(env.settings,after);published=true;return 'confirmed';}});
 assert(published);assert.equal(result.verification.passed,true);assert.equal((await env.journal.list())[0].stage,'complete');
});
test('project stage failure rolls back only owned new bytes and preserves old data',async()=>{
 const source=fixture(),env=environment(source),original=[...env.values.keys()];
 const plan=await makeRestorePlan({backup:await backup(),current:env.settings,store:env.store,projects:source.projects,mode:'copy'});
 env.projects.putNew=async()=>{throw Object.assign(new Error('quota'),{name:'QuotaExceededError'});};
 await assert.rejects(applyRestore({...env,plan,commitSettings:async()=>{throw new Error('must not publish');}}),{name:'QuotaExceededError'});
 assert.deepEqual([...env.values.keys()],original);assert.equal(env.rows.size,1);assert.equal((await env.journal.list())[0].stage,'rolled-back');
});
test('rollback does not delete another operation asset/project created after the preview',async()=>{
 const env=environment(),plan=await makeRestorePlan({backup:await backup(),current:env.settings,store:env.store,projects:[],mode:'copy'}),project=plan.projectWrites[0];
 const persist=env.journal.put;
 env.journal.put=async op=>{await persist(op);if(op.stage==='assets-staged')env.rows.set(project.id,{...project,title:'Third-party concurrent draft',revision:1});};
 await assert.rejects(applyRestore({...env,plan,commitSettings:async()=> 'confirmed'}),/project conflict/);
 assert.equal(env.rows.get(project.id).title,'Third-party concurrent draft');
 const other=environment(),second=await makeRestorePlan({backup:await backup(),current:other.settings,store:other.store,projects:[],mode:'copy'}),[id,blob]=second.assetWrites[0];
 other.store.putMany=async()=>{other.values.set(id,blob);other.owners.set(id,'another-operation');throw new Error('conflict');};
 await assert.rejects(applyRestore({...other,plan:second,commitSettings:async()=> 'confirmed'}),/conflict/);
 assert.equal(other.values.get(id),blob);assert.equal(other.owners.get(id),'another-operation');
});
test('ambiguous settings failures retain staged data; readback can confirm or roll back safely',async()=>{
 for(const committed of [false,true]){
  const env=environment(),plan=await makeRestorePlan({backup:await backup(),current:env.settings,store:env.store,projects:[],restorePreferences:true});
  await assert.rejects(applyRestore({...env,plan,commitSettings:async()=>{throw new Error('response lost');}}),/response lost/);
  const op=(await env.journal.list())[0];assert.equal(op.stage,'needs-review');assert(env.values.size);
  const recovered=await recoverRestore({...env,op,remote:committed?plan.after:plan.before,localSettings:env.settings});
  assert.equal(recovered.status,committed?'confirmed':'rolled-back');assert.equal(env.values.size>0,committed);
 }
});
test('changed settings or projects invalidate preview; unrelated remote changes never trigger automatic overwrite',async()=>{
 const env=environment(),plan=await makeRestorePlan({backup:await backup(),current:env.settings,store:env.store,projects:[]});
 env.settings.volume=.1;await assert.rejects(applyRestore({...env,plan,commitSettings:async()=> 'confirmed'}),/重新预览/);assert.equal(env.values.size,0);
 const op={before:plan.before,after:plan.after,id:'op',assets:[],projectIds:[]};
 const result=await recoverRestore({...env,op,remote:env.settings,localSettings:env.settings});assert.equal(result.status,'needs-review');
});
test('same-size replacement of reused bytes invalidates restore before any journal or settings write',async()=>{
 const env=environment(fixture()),plan=await makeRestorePlan({backup:await backup(),current:env.settings,store:env.store,projects:await env.projects.list()});
 const row=plan.reusedAssets[0],original=env.values.get(row.id);env.values.set(row.id,new Blob([new Uint8Array(original.size).fill(92)]));
 await assert.rejects(applyRestore({...env,plan,commitSettings:async()=>{throw new Error('must not publish');}}),/资源发生变化/);assert.equal(env.operations.size,0);
});
