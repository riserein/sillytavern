import {base64Bytes} from '../base64.js';
function yieldTask(win,signal){
    signal.throwIfAborted();
    return new Promise((resolve,reject)=>{
        const stop=()=>{win.clearTimeout(timer);reject(signal.reason);};
        const timer=win.setTimeout(()=>{signal.removeEventListener('abort',stop);resolve();},0);
        signal.addEventListener('abort',stop,{once:true});
    });
}
/** Decode only a requested track, share in-flight reads, and cancel on role exit. */
export function createEmbeddedStore(win){
    const blobs=new Map(),encoded=new Map(),pending=new Map(),controller=new AbortController();let disposed=false;
    const store={
        async get(id){
            if(disposed)return undefined;if(blobs.has(id))return blobs.get(id);if(pending.has(id))return pending.get(id);if(!encoded.has(id))return undefined;
            const task=(async()=>{
                const value=encoded.get(id),comma=value.indexOf(','),parts=[];
                for(let at=comma+1;at<value.length;at+=65536){
                    controller.signal.throwIfAborted();parts.push(base64Bytes(value.slice(at,at+65536)));
                    if(parts.length%8===0)await yieldTask(win,controller.signal);
                }
                controller.signal.throwIfAborted();const blob=new win.Blob(parts,{type:value.slice(5,value.indexOf(';'))});
                if(!disposed&&encoded.get(id)===value){blobs.set(id,blob);encoded.delete(id);return blob;}
                return undefined;
            })().finally(()=>pending.delete(id));pending.set(id,task);return task;
        },
        async put(id,blob){if(disposed)throw new DOMException('播放器已关闭','AbortError');encoded.delete(id);blobs.set(id,blob);},
        async delete(id){encoded.delete(id);blobs.delete(id);},
        async deleteMany(ids){for(const id of ids)await store.delete(id);},
    };
    return {store,setBlob(id,blob){blobs.set(id,blob);},setData(id,value){encoded.set(id,value);},get resourceCounts(){return {blobs:blobs.size,encodedAudio:encoded.size,pendingDecodes:pending.size};},dispose(){if(disposed)return;disposed=true;controller.abort();blobs.clear();encoded.clear();pending.clear();}};
}
