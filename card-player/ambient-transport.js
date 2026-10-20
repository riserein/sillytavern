import {normalizeAmbientLibrary,normalizeSoundscape,selectedAmbient} from '../ambient.js';
import {checksum} from '../data/checksum.js';
import {publicResource} from '../public-resource.js';
const metadata=row=>({id:row.id,title:row.title,icon:row.icon,volume:row.volume,loop:row.loop});
/** The serialized dictionary owns each distinct ambient payload ONCE. */
export async function prepareAmbientPackage({library,sceneSet,preference,mainHashes,getBlob,encodeBlob,probeAudio,signal,add,audioMime,checkedImage,maxAudioBytes}){
 const selected=selectedAmbient(library,sceneSet,preference);if(!selected.length)return {};
 const assets={},rows=[];
 for(const row of selected){signal?.throwIfAborted();const result=metadata(row);
  if(row.kind==='url'){const url=publicResource(row.url);if(!url)throw new Error('环境音「'+row.title+'」缺少稳定公开 HTTPS 音源。');await probeAudio(url,signal);result.url=url;}
  else {const blob=await getBlob(row.resourceId||row.id);if(!blob?.size)throw new Error('环境音「'+row.title+'」文件缺失，未生成部分播放器。');if(blob.size>maxAudioBytes)throw new Error('环境音「'+row.title+'」超过单音源 20 MiB 上限；未删除或转码音频。');const mime=audioMime(blob,blob.name||row.title);if(!mime)throw new Error('环境音格式无法确认，请重新导入。');
   const hash=(await checksum(blob,{signal})).sha256;if(mainHashes.has(hash))result.sourceTrackId=mainHashes.get(hash);else {const key='audio:'+hash;if(!assets[key]){assets[key]=await encodeBlob(add(blob,'ambient-audio',row.title),mime);await probeAudio(assets[key],signal);}result.sourceKey=key;}
  }
  if(row.coverId){const blob=await getBlob(row.coverId);if(!blob)throw new Error('环境音封面缺失，未生成部分播放器。');checkedImage(blob);const key='cover:'+(await checksum(blob,{signal})).sha256;if(!assets[key])assets[key]=await encodeBlob(add(blob,'cover',row.title+' · 环境音封面'));result.coverKey=key;}
  rows.push(result);
 }
 const soundscape=normalizeSoundscape(preference);for(const key of ['overrideEnabled','overrideVolume','overrideSelection','overrideFade'])soundscape[key]=false;
 return {ambientLibrary:rows,ambientAssets:assets,soundscape};
}
export function normalizePortableAmbient(raw,tracks,{portableAudio,portableImage}){
 if(raw.ambientLibrary===undefined&&raw.ambientAssets===undefined)return {};
 if(!Array.isArray(raw.ambientLibrary)||raw.ambientLibrary.length>50)throw new Error('随卡环境音数量无效。');
 const canonical=normalizeAmbientLibrary(raw.ambientLibrary.map(row=>({...row,kind:'local'})));if(canonical.length!==raw.ambientLibrary.length)throw new Error('随卡环境音标识无效或重复。');
 const source=raw.ambientAssets||{},assets={},used=new Set();if(typeof source!=='object'||Array.isArray(source)||Object.keys(source).length>100)throw new Error('随卡音景资源目录无效。');
 for(const [key,value]of Object.entries(source)){const type=key.split(':')[0];if(!/^(?:audio|cover):[a-f0-9]{64}$/.test(key)||typeof value!=='string'||!value.startsWith('data:')||!(type==='audio'?portableAudio(value):portableImage(value)))throw new Error('随卡音景资源格式无效。');assets[key]=value;}
 const rows=raw.ambientLibrary.map((row,index)=>{const result=metadata(canonical[index]);if([row.sourceKey,row.sourceTrackId,row.url].filter(Boolean).length!==1)throw new Error('环境音必须引用一个确定音源。');
  if(row.sourceKey){if(!row.sourceKey.startsWith('audio:')||!assets[row.sourceKey])throw new Error('环境音音频资源缺失。');result.sourceKey=row.sourceKey;used.add(row.sourceKey);}
  if(row.sourceTrackId){if(!tracks.some(t=>t.id===row.sourceTrackId))throw new Error('环境音引用的共享歌曲资源缺失。');result.sourceTrackId=row.sourceTrackId;}
  if(row.url){result.url=publicResource(row.url);if(!result.url)throw new Error('随卡环境音直链不安全或不可分发。');}
  if(row.coverKey){if(!row.coverKey.startsWith('cover:')||!assets[row.coverKey])throw new Error('环境音封面资源缺失。');result.coverKey=row.coverKey;used.add(row.coverKey);}return result;
 });
 if(used.size!==Object.keys(assets).length)throw new Error('音景目录存在未引用资源，未携带不明内容。');
 return {ambientLibrary:rows,ambientAssets:assets,soundscape:normalizeSoundscape(raw.soundscape)};
}
