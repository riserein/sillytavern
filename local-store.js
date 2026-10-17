import { databaseName, getStorageScope } from './data/identity.js';
/** Audio and background images stay in this browser; only metadata is saved to SillyTavern. */
export class LocalMusicStore {
    #database;
    constructor({scope=getStorageScope().key, indexedDB=globalThis.indexedDB}={}) { this.scope=scope; this.indexedDB=indexedDB; }

    async #open() {
        if (!this.indexedDB) throw new Error('浏览器不支持本地音乐存储，请改用音乐直链。');
        this.#database ??= new Promise((resolve, reject) => {
            const request = this.indexedDB.open(databaseName('riserein-sillytavern-music',this.scope), 1);
            request.onupgradeneeded = () => request.result.createObjectStore('tracks');
            request.onsuccess = () => {
                const db = request.result;
                db.onversionchange = () => { db.close(); this.#database = undefined; };
                resolve(db);
            };
            request.onerror = () => reject(request.error);
            request.onblocked = () => reject(new Error('音乐存储暂时被其他页面占用，请关闭其他酒馆页面后重试。'));
        }).catch(error => { this.#database = undefined; throw error; });
        return this.#database;
    }

    async #run(mode, operation) {
        const database = await this.#open();
        return new Promise((resolve, reject) => {
            const transaction = database.transaction('tracks', mode);
            let request, operationError;
            transaction.oncomplete = () => resolve(request.result);
            transaction.onerror = transaction.onabort = () => reject(operationError || transaction.operationError || transaction.error || new Error('音乐存储操作被中断。'));
            try { request = operation(transaction.objectStore('tracks')); }
            catch (error) { operationError = error; transaction.abort(); }
        });
    }

    async count() { const keys=await this.#run('readonly',store=>store.getAllKeys());return keys.filter(key=>!(Array.isArray(key)&&key[0]==='@rscp-owner-v1')).length; }
    entries() {
        return this.#run('readonly', store => {
            const keys=store.getAllKeys(), values=store.getAll();
            return {get result(){ return keys.result.map((key,i)=>[key,values.result[i]]).filter(([key,value])=>!(Array.isArray(key)&&key[0]==='@rscp-owner-v1'&&value?.marker==='rscp-owner-v1')); }};
        });
    }
    putMany(entries, {ifAbsent=false,owner}={}) {
        return this.#run('readwrite', store => {
            for(const [id,blob] of entries) {
                if(!(blob instanceof Blob)) throw new Error('本地资源必须是二进制文件。');
                const write=()=>{store.put(blob,id);if(owner)store.put({marker:'rscp-owner-v1',owner},['@rscp-owner-v1',id]);else store.delete(['@rscp-owner-v1',id]);};
                if(!ifAbsent) write();
                else {
                    const request=store.getKey(id);
                    request.onsuccess=()=>{
                        if(request.result!==undefined) {store.transaction.operationError=new Error('资源 ID 已存在，未覆盖原文件。');store.transaction.abort();}
                        else write();
                    };
                }
            }
            return {result:undefined};
        });
    }
    async close() { if(this.#database) (await this.#database).close(); this.#database=undefined; }
    owner(id) { return this.get(['@rscp-owner-v1',id]).then(row=>row?.marker==='rscp-owner-v1'?row.owner:null); }
    put(id, blob) { return this.#run('readwrite', store => {const request=store.put(blob,id);store.delete(['@rscp-owner-v1',id]);return request;}); }
    get(id) { return this.#run('readonly', store => store.get(id)); }
    delete(id) { return this.deleteMany([id]); }
    deleteMany(ids) {
        if (!ids.length) return Promise.resolve();
        return this.#run('readwrite', store => {
            let request;
            for (const id of ids) { request = store.delete(id); store.delete(['@rscp-owner-v1',id]); }
            return request;
        });
    }
}
