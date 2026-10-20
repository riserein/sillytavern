import {publicResource} from './public-resource.js';
export const MAX_AMBIENT=50;
export const AMBIENT_FADES=[0,500,1000,2000];
const bounded=(value,fallback)=>Number.isFinite(value)?Math.min(1,Math.max(0,value)):fallback;
const id=value=>typeof value==='string'&&value.length>0&&value.length<=128&&/^[\w:-]+$/.test(value);
export function normalizeAmbientLibrary(input){
 const seen=new Set(),result=[];for(const row of Array.isArray(input)?input:[]){
  if(!row||!id(row.id)||seen.has(row.id)||!['local','url'].includes(row.kind))continue;
  const url=row.kind==='url'?publicResource(row.url):null;if(row.kind==='url'&&!url)continue;seen.add(row.id);
  result.push({id:row.id,kind:row.kind,title:String(row.title||'环境音').slice(0,100),...(/^[a-f0-9]{64}$/.test(row.sha256)?{sha256:row.sha256}:{}),...(url?{url}:{}),...(id(row.resourceId)?{resourceId:row.resourceId}:{}),coverId:/^cover:[a-f0-9-]{36}$/.test(row.coverId)?row.coverId:null,icon:['rain','sea','forest','fire','city','wind','room'].includes(row.icon)?row.icon:'rain',volume:bounded(row.volume,.25),loop:row.loop!==false});if(result.length===MAX_AMBIENT)break;
 }return result;
}
export function normalizeSoundscape(raw={}){
 raw=raw&&typeof raw==='object'?raw:{};return {id:id(raw.id)?raw.id:null,enabled:raw.enabled===true,volume:bounded(raw.volume,.25),fade:AMBIENT_FADES.includes(raw.fade)?raw.fade:500,keepOnPause:raw.keepOnPause!==false,overrideEnabled:raw.overrideEnabled===true,overrideVolume:raw.overrideVolume===true,overrideSelection:raw.overrideSelection===true,overrideFade:raw.overrideFade===true};
}
export function normalizeSceneAmbient(raw={}){return {id:id(raw.id)?raw.id:null,enabled:raw.enabled===true,volume:bounded(raw.volume,.25),fade:AMBIENT_FADES.includes(raw.fade)?raw.fade:500};}
export function ambientShapeKnown(value){return value===undefined||Array.isArray(value)&&normalizeAmbientLibrary(value).length===value.length&&value.every(row=>[row.resourceId,row.coverId].every(id=>id===undefined||id===null||typeof id==='string'));}
export function ambientReferences(library){const refs=new Set();for(const row of Array.isArray(library)?library:[]){if(!row||typeof row!=='object')continue;if(row.kind==='local')refs.add(row.resourceId||row.id);if(row.coverId)refs.add(row.coverId);}return refs;}
export function selectedAmbient(library,sceneSet,preference){
 const ids=new Set((sceneSet?.scenes||[]).filter(s=>s.included!==false).map(s=>s.ambient?.id).filter(Boolean));if(preference?.id)ids.add(preference.id);
 const byId=new Map((library||[]).map(row=>[row.id,row]));for(const id of ids)if(!byId.has(id))throw new Error('场景引用的环境音缺失：'+id+'；未生成不完整播放器。');return [...ids].map(id=>byId.get(id));
}
export function sceneSoundscape(personal,scene,library){
 const base=normalizeSoundscape(personal),preset=scene?.ambient;if(!scene)return base;
 if(!preset)return {...base,id:base.overrideSelection?base.id:null,enabled:base.overrideEnabled?base.enabled:false};
 const row=(library||[]).find(r=>r.id===preset.id);
 return {...base,id:base.overrideSelection?base.id:preset.id,enabled:base.overrideEnabled?base.enabled:preset.enabled,volume:base.overrideVolume?base.volume:preset.volume??row?.volume??.25,fade:base.overrideFade?base.fade:preset.fade};
}
/** One lazy auxiliary HTMLAudioElement. Generation checks cover reads, play and fades. */
export function createAmbientEngine({createAudio,getBlob,onError=()=>{},onState=()=>{},host=globalThis,urls=URL}){
 let audio=null,current=null,url=null,epoch=0,disposed=false,desired=false,targetVolume=.25,frame=null,finishFade=null;
 const abort=new AbortController();
 function cancelFade(){if(frame!==null)host.cancelAnimationFrame(frame);frame=null;const finish=finishFade;finishFade=null;finish?.(false);}
 function ensure(){if(audio)return audio;audio=createAudio();audio.preload='metadata';audio.addEventListener('error',()=>{if(!disposed&&audio.getAttribute('src')){desired=false;cancelFade();audio.pause();onError(new Error('环境音无法加载：链接失效、格式不受支持或访问受限；主音乐不受影响。'));onState();}},{signal:abort.signal});for(const event of ['playing','pause','ended','loadedmetadata'])audio.addEventListener(event,()=>{if(!disposed)onState();},{signal:abort.signal});return audio;}
 function release(){if(audio){audio.pause();audio.removeAttribute('src');audio.load();}if(url)urls.revokeObjectURL(url);url=null;current=null;}
 function fade(to,duration,stamp){cancelFade();if(!audio||!duration||audio.paused){if(audio)audio.volume=to;return Promise.resolve(true);}const start=audio.volume,began=host.performance.now();return new Promise(resolve=>{finishFade=resolve;const step=now=>{frame=null;if(disposed||stamp!==epoch){finishFade=null;resolve(false);return;}const ratio=Math.min(1,Math.max(0,(now-began)/duration));audio.volume=start+(to-start)*ratio;if(ratio===1){finishFade=null;resolve(true);}else frame=host.requestAnimationFrame(step);};frame=host.requestAnimationFrame(step);});}
 async function choose(row,{play=false,volume=row?.volume??.25,fade:duration=500}={}){
  if(disposed)return false;const stamp=++epoch;cancelFade();desired=Boolean(play&&row);targetVolume=bounded(volume,.25);
  if(!row){release();onState();return true;}
  const element=ensure();
  try{
   if(current!==row.id||element.error||!element.getAttribute('src')){
    if(!await fade(0,AMBIENT_FADES.includes(duration)?duration:500,stamp)||stamp!==epoch||disposed)return false;
    release();let source=row.url;
    if(row.kind==='local'){const blob=await getBlob(row.resourceId||row.id);if(stamp!==epoch||disposed)return false;if(!blob?.size)throw new Error('环境音文件在当前浏览器中缺失，请重新导入；主音乐仍可播放。');url=urls.createObjectURL(blob);source=url;}
    else if(!publicResource(source))throw new Error('环境音需要稳定的公开 HTTPS 音频直链。');
    if(stamp!==epoch||disposed)return false;current=row.id;element.src=source;
   }
   element.loop=row.loop!==false;
   if(!desired){element.pause();element.volume=targetVolume;onState();return true;}
   if(element.paused){element.volume=0;await element.play();}
   if(disposed||stamp!==epoch){if(disposed||!desired)element.pause();return false;}
   await fade(targetVolume,AMBIENT_FADES.includes(duration)?duration:500,stamp);if(stamp!==epoch||disposed)return false;onState();return true;
  }catch(error){if(!disposed&&stamp===epoch){desired=false;element.pause();onError(new Error(error.name==='NotAllowedError'?'浏览器尚未允许环境音播放，请点击音景中的播放键。':element.error?'环境音无法加载：链接失效、格式不受支持或访问受限；主音乐不受影响。':'环境音播放失败：'+error.message));onState();}return false;}
 }
 return {choose,setVolume(value){targetVolume=bounded(value,.25);cancelFade();if(audio)audio.volume=targetVolume;onState();},pause(){desired=false;++epoch;cancelFade();audio?.pause();onState();},reset(){desired=false;++epoch;cancelFade();release();onState();},get audio(){return audio;},get currentId(){return current;},get playing(){return !!audio&&!audio.paused&&!audio.ended;},get pending(){return desired&&!current;},dispose(){if(disposed)return;disposed=true;desired=false;++epoch;cancelFade();abort.abort();release();audio?.remove();audio=null;}};
}
