import {test} from 'node:test';
import assert from 'node:assert/strict';
import {watchRoleLifetime} from '../card-player/lifecycle.js';

function fixture() {
    let role='a',disposed=0;
    const hooks=new Map();
    const subscribe=key=>handler=>{hooks.set(key,handler);return()=>hooks.delete(key);};
    const lifetime=watchRoleLifetime({roleId:'a',currentRole:()=>role,onRoleChange:subscribe('role'),onScriptExit:subscribe('script'),onHostExit:subscribe('host'),onFrameRemoved:subscribe('frame')},()=>disposed++);
    return {lifetime,hooks,setRole:value=>role=value,get disposed(){return disposed;}};
}
test('same-role chat changes preserve the instance; another role or home disposes every subscription',()=>{
    for(const destination of ['b',null]){
        const f=fixture();for(let i=0;i<10;i++)f.hooks.get('role')();assert.equal(f.disposed,0);assert.equal(f.lifetime.subscriptions,4);
        f.setRole(destination);f.hooks.get('role')();assert.equal(f.disposed,1);assert.equal(f.hooks.size,0);assert.equal(f.lifetime.disposed,true);assert.equal(f.lifetime.subscriptions,0);
    }
});
test('script deactivation, frame removal and host exit each dispose once even when cleanup is repeated',()=>{
    for(const event of ['script','frame','host']){const f=fixture();const exit=f.hooks.get(event);exit();exit();f.lifetime.dispose();assert.equal(f.disposed,1);assert.equal(f.hooks.size,0);}
});
test('an identity read failure fails closed and removes all observers/listeners',()=>{
    let fail=false,count=0;const hooks=[];
    const subscribe=handler=>{hooks.push(handler);return()=>count++;};
    const life=watchRoleLifetime({roleId:'a',currentRole:()=>{if(fail)throw new Error('owner unavailable');return'a';},onRoleChange:subscribe,onScriptExit:subscribe,onHostExit:subscribe,onFrameRemoved:subscribe},()=>count++);
    fail=true;hooks.at(-1)();assert.equal(life.disposed,true);assert.equal(count,5);
});
test('failed initialization unwinds previously acquired resources',()=>{
    let stops=0,disposes=0;
    assert.throws(()=>watchRoleLifetime({roleId:'a',currentRole:()=> 'a',onScriptExit:()=>()=>stops++,onHostExit:()=>{throw new Error('cannot register');},onFrameRemoved:()=>()=>{},onRoleChange:()=>()=>{}},()=>disposes++),/cannot register/);
    assert.equal(stops,1);assert.equal(disposes,1);
});
test('one failed unsubscriber does not prevent the remaining cleanup',()=>{
    let count=0;
    const life=watchRoleLifetime({roleId:'a',currentRole:()=> 'a',onScriptExit:()=>()=>{throw new Error('gone');},onHostExit:()=>()=>count++,onFrameRemoved:()=>()=>count++,onRoleChange:()=>()=>count++},()=>count++);
    life.dispose();assert.equal(count,4);assert.equal(life.subscriptions,0);
});
