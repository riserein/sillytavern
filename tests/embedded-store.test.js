import test from 'node:test';
import assert from 'node:assert/strict';
import {createEmbeddedStore} from '../card-player/embedded-store.js';
const host={Blob,setTimeout,clearTimeout};
test('embedded audio is decoded on demand once, with identical original bytes and unused tracks left encoded',async()=>{
 const a=createEmbeddedStore(host),bytes=Buffer.alloc(2*1024*1024+5,172),src='data:audio/mpeg;base64,'+bytes.toString('base64');a.setData('one',src);a.setData('two',src);
 assert.deepEqual(a.resourceCounts,{blobs:0,encodedAudio:2,pendingDecodes:0});const [first,again]=await Promise.all([a.store.get('one'),a.store.get('one')]);assert.equal(first,again);assert.deepEqual(Buffer.from(await first.arrayBuffer()),bytes);assert.equal(first.type,'audio/mpeg');assert.deepEqual(a.resourceCounts,{blobs:1,encodedAudio:1,pendingDecodes:0});a.dispose();assert(Object.values(a.resourceCounts).every(n=>n===0));
});
test('leaving during asynchronous decode cancels the task and never publishes late bytes',async()=>{
 const a=createEmbeddedStore(host);a.setData('one','data:audio/wav;base64,'+Buffer.alloc(2*1024*1024).toString('base64'));const read=a.store.get('one');assert.equal(a.resourceCounts.pendingDecodes,1);a.dispose();await assert.rejects(read,{name:'AbortError'});assert.equal(await a.store.get('one'),undefined);assert(Object.values(a.resourceCounts).every(n=>n===0));await assert.rejects(a.store.put('later',new Blob(['late'])),{name:'AbortError'});
});
