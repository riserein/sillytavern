import {hashText} from './data/checksum.js';
/** Private, account-scoped diary. Never part of author settings or card payloads.
 * IDB transactions serialize revision checks across tabs; the music DB is untouched. */
export const NOTE_LIMITS=Object.freeze({count:200,characters:2000,bytes:1024*1024});
const string=(value,max)=>typeof value==='string'&&value.length<=max?value:'';
const bytes=rows=>new TextEncoder().encode(JSON.stringify(rows)).length;
export function validatePrivateNotes(rows){
 if(!Array.isArray(rows)||rows.length>NOTE_LIMITS.count||bytes(rows)>NOTE_LIMITS.bytes)throw new Error('私人手记超过 200 条或 1 MiB；原有内容未更改。');
 const seen=new Set();return rows.map(row=>{
  if(!row||typeof row!=='object'||!string(row.id,100)||seen.has(row.id)||!string(row.role,300)||!string(row.script,200)||typeof row.text!=='string'||!row.text.trim()||Array.from(row.text).length>2000||!Number.isSafeInteger(row.revision)||row.revision<1||!Number.isSafeInteger(row.created)||!Number.isSafeInteger(row.updated))throw new Error('私人手记结构、字数、日期或版本无效，未部分恢复。');
  seen.add(row.id);return {id:row.id,role:row.role,script:row.script,project:string(row.project,200),trackId:string(row.trackId,200),trackTitle:string(row.trackTitle,200),sceneId:string(row.sceneId,200),sceneName:string(row.sceneName,200),text:row.text,revision:row.revision,created:row.created,updated:row.updated};
 });
}
export class PrivateNotesStore {
 constructor({authorize,indexedDB=globalThis.indexedDB}={}){this.authorize=authorize;this.idb=indexedDB;this.db=null;this.pending=null;this.account=null;this.closed=false;}
 async open(){
  if(this.closed)throw new Error('手记已关闭。');const account=await this.authorize?.();
  if(!account?.verified||!/^account-[a-f0-9]{64}$/.test(account.key))throw new Error('请先登录酒馆并刷新以确认账号；未读取其他账号的手记。');
  if(this.account&&this.account!==account.key)throw new Error('账号已改变，手记已锁定，请刷新。');this.account=account.key;
  if(!this.pending)this.pending=new Promise((resolve,reject)=>{const request=this.idb.open('riserein-private-notes-v1:'+account.key,1);request.onupgradeneeded=()=>request.result.createObjectStore('notes',{keyPath:'id'});request.onerror=()=>{this.pending=null;reject(request.error);};request.onblocked=()=>{this.pending=null;reject(new Error('手记数据库升级被其他页面阻挡，请关闭旧页面后重试。'));};request.onsuccess=()=>{const db=request.result;if(this.closed){db.close();reject(new Error('手记已关闭。'));return;}db.onversionchange=()=>{db.close();this.pending=null;this.db=null;};this.db=db;resolve(db);};});
  return this.pending;
 }
 async transaction(mode,operate){const db=await this.open();if(this.closed)throw new Error('手记已关闭。');return new Promise((resolve,reject)=>{const tx=db.transaction('notes',mode),store=tx.objectStore('notes');let value,failure;tx.oncomplete=()=>resolve(value);tx.onabort=()=>reject(failure||tx.error||new Error('手记保存失败，原内容未更改。'));tx.onerror=()=>{};const request=store.getAll();request.onsuccess=()=>{try{value=operate(request.result,store);}catch(e){failure=e;tx.abort();}};});}
 async list(scope=null){return this.transaction('readonly',rows=>validatePrivateNotes(rows).filter(row=>!scope||row.role===scope.role&&row.script===scope.script&&row.project===(scope.project||'')).sort((a,b)=>b.updated-a.updated));}
 async save(input,expectedRevision=0){return this.transaction('readwrite',(rows,store)=>{const previous=rows.find(row=>row.id===input.id);if((previous?.revision||0)!==expectedRevision)throw new Error('这条手记已在其他窗口更新，请重新读取或另存；未覆盖新内容。');const now=Date.now(),row={...input,id:input.id||crypto.randomUUID(),revision:expectedRevision+1,created:previous?.created||now,updated:now};const safe=validatePrivateNotes([...rows.filter(r=>r.id!==row.id),row]).find(r=>r.id===row.id);store.put(safe);return safe;});}
 async remove(id,revision){return this.transaction('readwrite',(rows,store)=>{const row=rows.find(r=>r.id===id);if(!row)return;if(row.revision!==revision)throw new Error('手记已被更新，未删除；请重新读取。');store.delete(id);});}
 /** Personal imports only insert fresh IDs, one transaction, never overwrite notes. */
 async importCopies(input,{roleMap={},scope=null,batchId=null}={}){const safe=validatePrivateNotes(input);return this.transaction('readwrite',(rows,store)=>{const now=Date.now(),copies=safe.map(row=>({...row,id:batchId?'import:'+hashText(batchId+'\0'+row.id+'\0'+JSON.stringify(scope||roleMap)):crypto.randomUUID(),revision:1,created:row.created,updated:now,...(scope||{role:roleMap[row.role]||row.role})})).filter(copy=>!rows.some(row=>row.id===copy.id));validatePrivateNotes([...rows,...copies]);for(const row of copies)store.add(row);return copies.length;});}
 close(){this.closed=true;this.db?.close();this.db=null;}
}
