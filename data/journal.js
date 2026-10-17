import {databaseName,getStorageScope} from './identity.js';
/** New account-scoped maintenance DB. No upgrades/deletes of either legacy database. */
export class MaintenanceJournal {
    constructor({indexedDB=globalThis.indexedDB,scope=getStorageScope().key}={}) {this.indexedDB=indexedDB;this.scope=scope;}
    async open() {
        if(!this.db) this.db=new Promise((resolve,reject)=>{
            const request=this.indexedDB.open(databaseName('riserein-music-maintenance',this.scope),1);
            request.onupgradeneeded=()=>{request.result.createObjectStore('operations',{keyPath:'id'});request.result.createObjectStore('retired',{keyPath:'id'});};
            request.onsuccess=()=>{const db=request.result;db.onversionchange=()=>{db.close();this.db=null;};resolve(db);};
            request.onerror=()=>reject(request.error);
            request.onblocked=()=>reject(new Error('维护记录暂时被其他页面占用。'));
        }).catch(error=>{this.db=null;throw error;});
        return this.db;
    }
    async run(name,mode,action) {
        const db=await this.open();
        return new Promise((resolve,reject)=>{
            const tx=db.transaction(name,mode);let request,error;
            tx.oncomplete=()=>resolve(request?.result);tx.onerror=tx.onabort=()=>reject(error||tx.error||new Error('维护记录保存失败，原数据未清空。'));
            try {request=action(tx.objectStore(name));} catch(e){error=e;tx.abort();}
        });
    }
    list(name='operations'){return this.run(name,'readonly',store=>store.getAll());}
    put(value,name='operations'){return this.run(name,'readwrite',store=>store.put(value));}
    delete(id,name='operations'){return this.run(name,'readwrite',store=>store.delete(id));}
    async close(){if(this.db)(await this.db).close();this.db=null;}
}
