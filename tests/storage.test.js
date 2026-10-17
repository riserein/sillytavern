import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture} from './data-fixtures.js';
import {storageSnapshot,cleanRetired,checkCapacity} from '../data/storage.js';
function environment(){
 const source=fixture(),values=new Map(source.entries),retired=[{id:'unused',confirmed:true},{id:'unconfirmed',confirmed:false},{id:source.settings.tracks[0].id,confirmed:true}],operations=[],rows=[];
 values.set('unused',new Blob(['unused']));values.set('unconfirmed',new Blob(['keep']));values.set('unknown',new Blob(['unknown']));
 return {settings:source.settings,values,retired,operations,rows,store:{entries:async()=>[...values],get:async id=>values.get(id),deleteMany:async ids=>ids.forEach(id=>values.delete(id))},projects:{list:async()=>rows},journal:{list:async type=>type==='retired'?retired:operations,delete:async id=>{const i=retired.findIndex(r=>r.id===id);if(i>=0)retired.splice(i,1);}},estimate:async()=>({quota:1e9,usage:10}),assertAccount:async()=>{},readRemote:async()=>source.settings};
}
test('storage cleanup only offers acknowledged unreferenced bytes and preserves unknown/unconfirmed/library resources',async()=>{
 const env=environment(),preview=await storageSnapshot(env);assert.deepEqual(preview.candidates,[{id:'unused',bytes:6}]);
 const result=await cleanRetired({...env,preview});assert.deepEqual(result,{removed:1,bytes:6});assert(env.values.has('unconfirmed'));assert(env.values.has('unknown'));assert(env.values.has(env.settings.tracks[0].id));
});
test('projects, unknown formats and unfinished restores conservatively block deletion',async()=>{
 for(const kind of ['project','unknown','pending']){
  const env=environment();if(kind==='project')env.rows.push({id:'draft',format:1,revision:1,sourceSettings:{},tracks:[{id:'unused',kind:'local'}]});
  if(kind==='unknown')env.rows.push({id:'future',format:2,tracks:[],revision:1});if(kind==='pending')env.operations.push({id:'operation',stage:'needs-review',assets:[]});
  const preview=await storageSnapshot(env);if(kind==='pending')await assert.rejects(cleanRetired({...env,preview}),/未完成恢复/);else assert.equal(preview.candidates.length,0);assert(env.values.has('unused'));
 }
});
test('changed scan and server references prevent cleanup without deleting anything',async()=>{
 const env=environment(),preview=await storageSnapshot(env);env.rows.push({id:'new',format:1,revision:1,tracks:[],sourceSettings:{}});await assert.rejects(cleanRetired({...env,preview}),/数据已改变/);assert(env.values.has('unused'));
 const second=environment(),snapshot=await storageSnapshot(second);second.readRemote=async()=>({...second.settings,tracks:[...second.settings.tracks,{id:'unused',kind:'local'}]});await assert.rejects(cleanRetired({...second,preview:snapshot}),/服务器仍引用/);assert(second.values.has('unused'));
});
test('quota estimate refuses insufficient staging space but unavailable estimates are not presented as guarantees',async()=>{
 await assert.rejects(checkCapacity(1000000,async()=>({quota:1000000,usage:100})),/空间不足/);assert.equal((await checkCapacity(1,async()=>{throw new Error('unsupported');})).estimatedOnly,true);
});
