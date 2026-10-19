import test from 'node:test';
import assert from 'node:assert/strict';
import {identifyAccount,databaseName,preferenceKey,createAccountGuard} from '../data/identity.js';
import {accountPreferences,rolePreferences} from '../card-player/preferences.js';
test('account identity follows authenticated server primary key and creation, never display name',async()=>{
 const identify=profile=>identifyAccount({fetcher:async()=>Response.json(profile)});
 const a=await identify({handle:'account-a',created:100,name:'Name'}),renamed=await identify({handle:'account-a',created:100,name:'Other'}),recreated=await identify({handle:'account-a',created:101,name:'Name'}),b=await identify({handle:'account-b',created:100,name:'Name'});
 assert.equal(a.key,renamed.key);assert.notEqual(a.key,recreated.key);assert.notEqual(a.key,b.key);assert(!a.key.includes('account-a'));
 assert.notEqual(databaseName('library',a.key),databaseName('library',b.key));assert.equal(databaseName('library','legacy'),'library');assert.throws(()=>databaseName('library',null),/未确认/);
 assert.notEqual(preferenceKey('last',a.key),preferenceKey('last',b.key));
 assert(!Object.keys(a).includes('guardIdentity'));assert(!JSON.stringify(a).includes('guardIdentity'));
});
test('missing, unauthenticated or unsupported identity refuses to guess an account',async()=>{
 for(const profile of [{name:'Display only'},{handle:'a',created:null},{handle:'a',created:'now'}])await assert.rejects(identifyAccount({fetcher:async()=>Response.json(profile)}),/账号标识/);
 await assert.rejects(identifyAccount({fetcher:async()=>new Response('denied',{status:403})}),/未确认/);
});
test('official account response may include an ordinary avatar larger than 64 KiB but remains bounded',async()=>{
 const result=await identifyAccount({fetcher:async()=>Response.json({handle:'avatar-user',created:123,avatar:'x'.repeat(100000)})});assert(result.verified);assert(!JSON.stringify(result).includes('avatar:'));
 await assert.rejects(identifyAccount({fetcher:async()=>new Response('ignored',{headers:{'Content-Length':String(17*1024*1024)}})}),/过大/);
});
test('role/script preferences stay in the official account store; old global preferences require explicit adoption',()=>{
 const a=accountPreferences({}),b=accountPreferences({}),old=new Map([['v1',JSON.stringify({volume:.9})]]),window={localStorage:{getItem:key=>old.get(key)||null,setItem:(k,v)=>old.set(k,v)}};
 const first=rolePreferences({preferences:a,hostWindow:window},'v2','v1');assert.deepEqual(first.read(),{});assert(first.legacy);first.write({volume:.2});assert.deepEqual(rolePreferences({preferences:a,hostWindow:window},'v2','v1').read(),{volume:.2});assert.deepEqual(rolePreferences({preferences:b,hostWindow:window},'v2','v1').read(),{});assert(old.has('v1'));assert(!old.has('v2'));
});
test('account preference writes require current authorization and a late older result cannot overwrite a newer edit',async()=>{
 const values=new Map(),checks=[],storage={getItem:key=>values.get(key)||null,setItem:(key,value)=>values.set(key,value)},p=accountPreferences({accountStorage:storage},()=>new Promise((resolve,reject)=>checks.push({resolve,reject})));
 p.setItem('volume','old');p.setItem('volume','new');await new Promise(r=>setTimeout(r,0));checks[1].resolve();checks[0].resolve();await new Promise(r=>setTimeout(r,0));assert.equal(values.get('volume'),'new');p.setItem('volume','wrong-account');await new Promise(r=>setTimeout(r,0));checks[2].reject(new Error('changed account'));await new Promise(r=>setTimeout(r,0));assert.equal(values.get('volume'),'new');
});
test('opaque-origin maker preview still runs when merely accessing localStorage throws SecurityError',async()=>{
 const host={get localStorage(){throw new DOMException('opaque sandbox','SecurityError');}},prefs=rolePreferences({hostWindow:host},'new','old');assert.deepEqual(prefs.read(),{});assert.equal(await prefs.write({volume:.3}),false);
});
test('a confirmed account mismatch stays blocked after disposal under a retained extension wrapper',async()=>{
 let active='account-a',writes=0,mismatches=0;
 const previous=async input=>{if(String(input).endsWith('/api/users/me'))return Response.json({handle:active,created:123});writes++;return Response.json({result:'ok'});};
 const account=await identifyAccount({fetcher:previous}),host=new EventTarget(),doc=new EventTarget();doc.visibilityState='visible';
 Object.assign(host,{fetch:previous,location:new URL('https://host.example/'),document:doc,URL,Response,JSON,String});
 const guard=createAccountGuard({account,context:{getRequestHeaders:()=>({})},host,onMismatch:()=>mismatches++});
 const retained=host.fetch;host.fetch=function(...args){return retained.apply(this,args);};
 active='account-b';assert.equal((await host.fetch('/api/settings/save')).status,409);assert.equal(mismatches,1);
 guard.dispose();host.Response=undefined;host.URL=undefined;
 const blocked=await host.fetch('/api/settings/save');assert.equal(blocked.status,409);assert.match((await blocked.json()).error,/账号已切换/);assert.equal(writes,0);
});
