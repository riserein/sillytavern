import { sha256 } from '../vendor/sha256.js';
import { boundedBytes } from '../bounded-response.js';
// The synchronous library API retains its explicit legacy mode for old callers/tests.
// The real extension startup resolves /api/users/me BEFORE constructing either store.
let active = {key:'legacy',verified:false,label:'尚未确认归属的旧存储'};
const hex = bytes => [...bytes].map(byte=>byte.toString(16).padStart(2,'0')).join('');
export function getStorageScope() { return {...active}; }
export function setStorageScope(value) { active = {...value}; }
export async function identifyAccount({fetcher=globalThis.fetch,headers={},signal}={}) {
    const combined = signal ? AbortSignal.any([signal,AbortSignal.timeout(5000)]) : AbortSignal.timeout(5000);
    const response = await fetcher('/api/users/me',{headers,credentials:'same-origin',signal:combined,cache:'no-store'});
    if(!response.ok || response.redirected) throw new Error('酒馆未确认当前账号，已暂停本地存储读写；请重新登录并刷新。');
    // Official /me also returns the base64 avatar; the default avatar alone exceeds 64 KiB.
    // Keep a finite bound while allowing normal uploaded pictures. Never persist/log the avatar.
    const profile = JSON.parse(new TextDecoder().decode(await boundedBytes(response,16*1024*1024,combined)));
    if(typeof profile.handle!=='string' || !profile.handle || profile.handle.length>128 || !Number.isSafeInteger(profile.created) || profile.created<=0)
        throw new Error('当前酒馆没有提供受支持的稳定账号标识，本地存储保持锁定。');
    // handle is the server's internal account primary key; created prevents handle-reuse adoption.
    return {key:'account-'+hex(sha256(new TextEncoder().encode(JSON.stringify([profile.handle,profile.created])))),verified:true,label:String(profile.name||'当前账号').slice(0,80)};
}
export function databaseName(base,scope=getStorageScope().key) {
    if(scope===null || scope===undefined) throw new Error('当前账号身份尚未确认，不能访问本地资源。');
    if(scope==='legacy') return base;
    if(!/^account-[a-f0-9]{64}$/.test(scope)) throw new Error('账号存储标识无效。');
    return `${base}:${scope}`;
}
export function preferenceKey(name,scope=getStorageScope().key) { return `${name}:${scope||'locked'}`; }

export function createAccountGuard({account,context,host=window,onMismatch=()=>{}}) {
    const previous=host.fetch,controller=new AbortController();let disposed=false,locked=false;
    const assert=async()=>{
        controller.signal.throwIfAborted();
        const current=await identifyAccount({fetcher:previous.bind(host),headers:context.getRequestHeaders(),signal:controller.signal});
        controller.signal.throwIfAborted();
        if(current.key!==account.key){locked=true;onMismatch();throw new Error('酒馆账号已切换，已停止旧播放器；请刷新当前页面。');}
        return current;
    };
    async function wrapped(input,init) {
        const target=new URL(typeof input==='string'?input:input?.url||String(input),host.location.href);
        if(target.origin===host.location.origin&&['/api/settings/save','/api/characters/merge-attributes'].includes(target.pathname)){
            // A stale host page can keep saving AFTER the player has been disposed.
            // Keep this tiny forwarding guard until reload; release all player listeners below.
            if(locked)return Response.json({error:'酒馆账号已切换，请刷新旧页面后再保存。'},{status:409});
            if(disposed)return previous.call(this,input,init);
            try{await assert();}catch(error){return Response.json({error:error.message},{status:409});}
        }
        return previous.call(this,input,init);
    }
    const check=()=>{if(!disposed&&host.document.visibilityState!=='hidden')void assert().catch(()=>{});};
    let channel;
    try{
        if(host.BroadcastChannel){channel=new host.BroadcastChannel('riserein:verified-account');channel.onmessage=event=>{
            if(!disposed&&event.data?.type==='active-account'&&/^account-[a-f0-9]{64}$/.test(event.data.key)&&event.data.key!==account.key){locked=true;onMismatch();}
        };channel.postMessage({type:'active-account',key:account.key});}
    }catch{/* Focus and pre-save verification remain available on unsupported hosts. */}
    host.fetch=wrapped;host.addEventListener('focus',check);host.document.addEventListener('visibilitychange',check);
    return {assert,dispose(){disposed=true;controller.abort();channel?.close();channel=null;host.removeEventListener('focus',check);host.document.removeEventListener('visibilitychange',check);if(!locked&&host.fetch===wrapped)host.fetch=previous;context=null;account=null;onMismatch=null;}};
}
