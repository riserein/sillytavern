import test from 'node:test';
import assert from 'node:assert/strict';
import {identifyAccount,databaseName,preferenceKey} from '../data/identity.js';
test('account identity follows authenticated server primary key and creation, never display name',async()=>{
 const identify=profile=>identifyAccount({fetcher:async()=>Response.json(profile)});
 const a=await identify({handle:'account-a',created:100,name:'Name'}),renamed=await identify({handle:'account-a',created:100,name:'Other'}),recreated=await identify({handle:'account-a',created:101,name:'Name'}),b=await identify({handle:'account-b',created:100,name:'Name'});
 assert.equal(a.key,renamed.key);assert.notEqual(a.key,recreated.key);assert.notEqual(a.key,b.key);assert(!a.key.includes('account-a'));
 assert.notEqual(databaseName('library',a.key),databaseName('library',b.key));assert.equal(databaseName('library','legacy'),'library');assert.throws(()=>databaseName('library',null),/未确认/);
 assert.notEqual(preferenceKey('last',a.key),preferenceKey('last',b.key));
});
test('missing, unauthenticated or unsupported identity refuses to guess an account',async()=>{
 for(const profile of [{name:'Display only'},{handle:'a',created:null},{handle:'a',created:'now'}])await assert.rejects(identifyAccount({fetcher:async()=>Response.json(profile)}),/账号标识/);
 await assert.rejects(identifyAccount({fetcher:async()=>new Response('denied',{status:403})}),/未确认/);
});
