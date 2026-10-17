import {boundedBytes} from '../bounded-response.js';
import {settingsHash} from './restore.js';
const KEY='riserein_music_player';
const defaults={theme:'night',colorScheme:'dark',surface:'matte',panelSize:{width:640,height:700}};
export function createSettingsCommitter({context,settings,assertAccount,host=window,timeout=15000}) {
    const previous=host.fetch,controller=new AbortController();let pending=null,disposed=false;
    async function remote() {
        await assertAccount();controller.signal.throwIfAborted();
        const response=await host.fetch('/api/settings/get',{method:'POST',headers:context.getRequestHeaders(),body:'{}',signal:AbortSignal.any([controller.signal,AbortSignal.timeout(12000)]),cache:'no-store'});
        if(!response.ok||response.redirected)throw new Error('未能读取酒馆保存的音乐设置；现有数据和暂存资源已保留。');
        const payload=JSON.parse(new TextDecoder().decode(await boundedBytes(response,32*1024*1024,controller.signal)));
        const all=typeof payload.settings==='string'?JSON.parse(payload.settings):payload.settings;
        if(!all||typeof all!=='object')throw new Error('酒馆设置读取格式不受支持，未覆盖任何设置。');
        return all.extension_settings?.[KEY]||defaults;
    }
    async function wrapped(input,init) {
        if(disposed)return previous.call(this,input,init);
        const url=new URL(typeof input==='string'||input instanceof URL?input:input.url,host.location.href),watch=pending;
        let posted;
        if(watch&&url.origin===host.location.origin&&url.pathname==='/api/settings/save') {
            posted=(async()=>{
                const request=input instanceof Request?input.clone():new Request(url.href,init);
                let body=new Response(request.body);
                if(request.headers.get('Content-Encoding')?.toLowerCase()==='gzip')body=new Response(body.body.pipeThrough(new DecompressionStream('gzip')));
                return (await body.json()).extension_settings?.[KEY];
            })().catch(()=>null);
        }
        const response=await previous.call(this,input,init);
        if(watch&&posted&&!disposed) {
            const snapshot=await posted;
            if(snapshot&&settingsHash(snapshot)===watch.hash) {
                let ack=false;try{ack=response.ok&&!response.redirected&&(await response.clone().json()).result==='ok';}catch{/* Readback resolves ambiguity. */}
                watch.finish(ack);
            }
        }
        return response;
    }
    host.fetch=wrapped;
    return {remote,async commit(next,before) {
        if(pending)throw new Error('另一项恢复仍在保存，请先完成核对。');
        const saved=await remote();if(settingsHash(saved)!==settingsHash(before))throw new Error('服务器音乐设置与预览前不同，未覆盖；请刷新后重新预览。');
        if(settingsHash(settings)!==settingsHash(before))throw new Error('恢复期间本地设置已改变，未覆盖新编辑；请重新预览。');
        controller.signal.throwIfAborted();
        let timer;
        const acknowledged=new Promise(resolve=>{
            const finish=value=>{clearTimeout(timer);resolve(value);};
            pending={hash:settingsHash(next),finish};timer=setTimeout(()=>finish(false),timeout);
        });
        try {
            Object.assign(settings,structuredClone(next));context.extensionSettings[KEY]=settings;
            context.saveSettingsDebounced();await acknowledged;
            const actual=await remote();
            if(settingsHash(actual)===settingsHash(next))return 'confirmed';
            if(settingsHash(actual)===settingsHash(before))Object.assign(settings,structuredClone(before));
            throw new Error('酒馆尚未确认恢复后的设置；没有删除暂存文件，请在恢复记录中重新核对。');
        } finally {clearTimeout(timer);pending=null;}
    },dispose(){disposed=true;controller.abort();pending?.finish(false);pending=null;if(host.fetch===wrapped)host.fetch=previous;}};
}
