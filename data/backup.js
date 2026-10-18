import {normalizeSettings} from '../core.js';
import {referencedAssets} from '../asset-retirement.js';
import {checksum,hashText} from './checksum.js';
import {zipBlob,readZip} from './zip.js';
import {normalizePlatformTrack} from '../platforms/catalog.js';
import {PLAYER_BUILD} from '../card-player/quality.js';
const encoder=new TextEncoder();
const TRACK_KEYS=['id','kind','title','artist','album','url','coverId','lyrics','lyricsSource','fallbackCover','platform','platformTrackId','remoteId','sourceUrl','playback','cover','duration','metadataStatus','restriction'];
const FORM_KEYS=['stm-maker-title','stm-maker-collection','stm-maker-theme','stm-maker-surface','accent','background','text','color:accent','color:background','color:text','opacity','font','font-credit','collapsed'];
const SOURCE_KEYS=['backgroundId','fontPreset','fontId','fontName','volume','mode','transitionDuration'];
const pick=(object,keys)=>Object.fromEntries(keys.filter(key=>Object.hasOwn(object||{},key)).map(key=>[key,object[key]]));
export const canonical=value=>JSON.stringify(value,(_key,item)=>item&&typeof item==='object'&&!Array.isArray(item)&&!(item instanceof Blob)?Object.fromEntries(Object.keys(item).sort().map(key=>[key,item[key]])):item);
function cleanUrl(value,warnings) {
    if(typeof value!=='string')return value;
    try {
        const url=new URL(value);let changed=Boolean(url.username||url.password);url.username='';url.password='';
        for(const key of [...url.searchParams.keys()])if(/token|api.?key|cookie|signature|auth|password|secret|credential|^key$|^sig$|^jwt$|^bearer$|x-amz-|x-goog-/i.test(key)){url.searchParams.delete(key);changed=true;}
        if(changed)warnings.add('部分远程链接中的认证参数已移除；恢复后需重新设置这些链接。');
        if(!['https:','http:'].includes(url.protocol))throw new Error('临时或非 HTTP 地址不能作为可迁移远程音源。');
        return url.href;
    } catch {throw new Error('备份中发现不能跨设备使用的远程地址，请先修正对应歌曲。');}
}
function trackMetadata(track,warnings) {
    const row=pick(track,TRACK_KEYS);
    for(const key of ['url','sourceUrl','cover','lyricsSource'])if(row[key])row[key]=cleanUrl(row[key],warnings);
    if(track.license){row.license=pick(track.license,['code','url','attribution','sourceUrl']);for(const key of ['url','sourceUrl'])if(row.license[key])row.license[key]=cleanUrl(row.license[key],warnings);}
    return row;
}
export function safeSettings(raw,warnings=new Set(),catalog=raw?.builtinCatalog) {
    const safe=JSON.parse(JSON.stringify(normalizeSettings(raw,Date.now(),catalog)));
    safe.tracks=safe.tracks.map(track=>trackMetadata(track,warnings));
    for(const list of safe.playlists)if(list.source){list.source=pick(list.source,['platform','id','url','name','author','total','cover']);for(const key of ['url','cover'])if(list.source[key])list.source[key]=cleanUrl(list.source[key],warnings);}
    return safe;
}
export function draftReferences(project) {
    const ids=new Set();
    for(const track of project.tracks||[]){if(track.kind==='local'&&!track.exportBlob&&!track.exportUrl)ids.add(track.id);if(track.coverId&&!track.exportCover)ids.add(track.coverId);}
    if(project.sourceSettings?.backgroundId&&!project.assets?.imageBlob)ids.add(project.sourceSettings.backgroundId);
    if(project.sourceSettings?.fontPreset==='custom'&&project.sourceSettings?.fontId&&!project.assets?.fontBlob)ids.add(project.sourceSettings.fontId);
    return ids;
}
export async function createBackup({settings,store,projects=[],version=PLAYER_BUILD,signal,onProgress=()=>{}}) {
    const warnings=new Set(),snapshot=safeSettings(settings,warnings),files=new Map(),resources=[];
    if(!Array.isArray(projects)||projects.length>10000)throw new Error('制作项目超过备份版本支持的数量，未生成部分备份。');
    for(const key of ['tracks','playlists','fonts'])if(Array.isArray(settings[key])&&settings[key].length!==snapshot[key].length)throw new Error('当前资料包含超限、重复或无效条目，未静默删减生成备份；请先核对曲库。');
    const all=new Map(await store.entries());
    const add=async(blob,label)=>{
        signal?.throwIfAborted();
        if(!(blob instanceof Blob))throw new Error(`${label} 文件缺失，未生成不完整备份。`);
        if(blob.size>128*1024*1024)throw new Error(`${label} 超过单项备份 128 MiB 上限，未舍弃文件。`);
        const digest=await checksum(blob,{signal,onProgress:(done,total)=>onProgress({phase:'checksum',label,done,total})});
        const path=`assets/${digest.sha256}.bin`;
        if(!files.has(path))files.set(path,{path,blob,crc32:digest.crc32});
        return {path,bytes:blob.size,sha256:digest.sha256,type:blob.type||'application/octet-stream'};
    };
    for(const id of referencedAssets(snapshot)) resources.push({id,...await add(all.get(id),'曲库资源')});
    const drafts=[];
    for(const project of projects){
        const copy={...pick(project,['id','title','format','updatedAt','revision','runtimeVersion','editRevision']),sourceSettings:pick(project.sourceSettings,SOURCE_KEYS),form:pick(project.form,FORM_KEYS),assets:{},tracks:[]};
        for(const track of project.tracks||[]){
            const row=trackMetadata(track,warnings);
            if(track.exportUrl)row.exportUrl=cleanUrl(track.exportUrl,warnings);
            const audio=track.exportBlob||(!row.exportUrl&&track.kind==='local'?all.get(track.id):null);
            if(audio)row.exportBlob=await add(audio,'项目音频');
            else if(track.kind==='local'&&!row.exportUrl)throw new Error('项目音频缺失，旧草稿与已有备份未覆盖。');
            const cover=track.exportCover||(track.coverId?all.get(track.coverId):null);
            if(cover)row.exportCover=await add(cover,'项目封面');else if(track.coverId)throw new Error('项目封面缺失，未生成不完整备份。');
            copy.tracks.push(row);
        }
        const image=project.assets?.imageBlob||(project.sourceSettings?.backgroundId?all.get(project.sourceSettings.backgroundId):null);
        const original=project.assets?.imageOriginalBlob||(project.sourceSettings?.backgroundId?all.get(project.sourceSettings.backgroundId+':original'):null);
        const font=project.assets?.fontBlob||(project.sourceSettings?.fontPreset==='custom'?all.get(project.sourceSettings.fontId):null);
        if(image)copy.assets.imageBlob=await add(image,'项目背景');
        if(original)copy.assets.imageOriginalBlob=await add(original,'项目背景原图');
        else if(image&&project.sourceSettings?.backgroundId)warnings.add('部分旧项目只有已保存的背景图，未找到早期原图；已存在的图片字节仍保留。');
        if(font)copy.assets.fontBlob=await add(font,'项目字体');
        if(project.sourceSettings?.backgroundId&&!image||project.sourceSettings?.fontPreset==='custom'&&!font)throw new Error('项目背景或字体缺失，未生成不完整备份。');
        drafts.push(copy);
        onProgress({phase:'projects',done:drafts.length,total:projects.length});
    }
    const catalog=(settings.builtinCatalog?.tracks||[]).filter(track=>settings.currentId===track.id||settings.favorites?.some(row=>row.trackId===track.id)||settings.playlists.some(list=>list.trackIds.includes(track.id))).map(track=>trackMetadata(track,warnings));
    const manifest={format:'riserein-music-backup',version:1,appVersion:version,createdAt:new Date().toISOString(),settings:snapshot,catalog,projects:drafts,resources,warnings:[...warnings],remoteAudio:'metadata-and-URLs-only; not offline audio'};
    const manifestBlob=new Blob([JSON.stringify(manifest)],{type:'application/json'});
    if(manifestBlob.size>64*1024*1024)throw new Error('备份目录超过 64 MiB 上限，未生成部分备份。');
    const manifestHash=await checksum(manifestBlob,{signal}),sidecar=new Blob([manifestHash.sha256+'\n'],{type:'text/plain'}),sideHash=await checksum(sidecar,{signal});
    const archive=zipBlob([{path:'manifest.json',blob:manifestBlob,crc32:manifestHash.crc32},{path:'manifest.sha256',blob:sidecar,crc32:sideHash.crc32},...files.values()]);
    onProgress({phase:'complete',done:archive.size,total:archive.size});
    return {blob:archive,manifest,counts:{tracks:snapshot.tracks.length,playlists:snapshot.playlists.length,projects:drafts.length,assets:files.size},bytes:archive.size};
}
const plain=value=>value&&typeof value==='object'&&!Array.isArray(value);
export async function inspectBackup(file,{signal,onProgress=()=>{}}={}) {
    const entries=await readZip(file,{signal}),meta=entries.get('manifest.json'),side=entries.get('manifest.sha256');
    if(!meta||meta.bytes>64*1024*1024||!side||side.bytes>100)throw new Error('不是受支持的音乐备份文件，或目录过大。');
    const digest=await checksum(meta.blob,{signal}),sideDigest=await checksum(side.blob,{signal});
    if(digest.crc32!==meta.crc32||sideDigest.crc32!==side.crc32||(await side.blob.text()).trim()!==digest.sha256)throw new Error('备份目录完整性检查失败，未修改当前曲库。');
    const manifest=JSON.parse(await meta.blob.text());
    if(manifest.format!=='riserein-music-backup'||manifest.version!==1)throw new Error('不支持此备份版本，请使用兼容版本播放器。');
    if(!plain(manifest.settings)||!Array.isArray(manifest.settings.tracks)||manifest.settings.tracks.length>200||!Array.isArray(manifest.settings.playlists)||manifest.settings.playlists.length>50||!Array.isArray(manifest.projects)||manifest.projects.length>10000||!Array.isArray(manifest.resources)||manifest.resources.length>10000)throw new Error('备份目录结构或数量超限。');
    const referenced=new Map(),resourceIds=new Set();
    const expectResource=row=>{
        if(!plain(row)||typeof row.path!=='string'||row.path!==`assets/${row.sha256}.bin`||!Number.isSafeInteger(row.bytes)||row.bytes<0||row.bytes>128*1024*1024||typeof row.type!=='string'||row.type.length>200)throw new Error('备份资源记录无效。');
        const entry=entries.get(row.path);if(!entry||entry.bytes!==row.bytes)throw new Error('备份资源缺失或字节数不符。');
        if(referenced.has(row.path)&&referenced.get(row.path).sha256!==row.sha256)throw new Error('备份资源标识冲突。');referenced.set(row.path,row);
    };
    for(const row of manifest.resources){if(typeof row.id!=='string'||row.id.length>500||resourceIds.has(row.id))throw new Error('备份资源 ID 无效或重复。');resourceIds.add(row.id);expectResource(row);}
    const projects=new Set();
    for(const project of manifest.projects){
        if(typeof project.id!=='string'||!project.id||projects.has(project.id)||!Array.isArray(project.tracks)||project.tracks.length>200||!plain(project.form)||!plain(project.sourceSettings))throw new Error('备份项目结构或 ID 无效。');
        projects.add(project.id);
        for(const track of project.tracks){if(track.exportBlob)expectResource(track.exportBlob);if(track.exportCover)expectResource(track.exportCover);}
        for(const key of ['imageBlob','imageOriginalBlob','fontBlob'])if(project.assets?.[key])expectResource(project.assets[key]);
    }
    if(entries.size!==referenced.size+2)throw new Error('ZIP 包含未在目录登记的文件，未导入。');
    let done=0;const verified=new Map();
    for(const [path,row] of referenced){
        const entry=entries.get(path),sum=await checksum(entry.blob,{signal});
        if(sum.sha256!==row.sha256||sum.crc32!==entry.crc32)throw new Error('备份资源 SHA-256/CRC 校验失败，未修改当前曲库。');
        verified.set(path,entry.blob);onProgress({phase:'verify',done:++done,total:referenced.size});
    }
    // Re-sanitize metadata on import; never trust arbitrary settings/project keys from a ZIP.
    if(!Array.isArray(manifest.catalog)||manifest.catalog.length>200)throw new Error('默认来源记录无效。');
    const warnings=new Set(Array.isArray(manifest.warnings)?manifest.warnings.filter(w=>typeof w==='string').map(w=>w.slice(0,500)):[]);
    manifest.catalog=manifest.catalog.map(track=>trackMetadata(track,warnings));
    const normalizedCatalog=manifest.catalog.map(normalizePlatformTrack);
    if(normalizedCatalog.some((track,i)=>!track||track.id!==manifest.catalog[i].id)||new Set(normalizedCatalog.map(t=>t.id)).size!==normalizedCatalog.length)throw new Error('默认来源记录无效或重复。');
    const safe=safeSettings(manifest.settings,warnings,{version:1,tracks:manifest.catalog});
    if(safe.tracks.length!==manifest.settings.tracks.length||safe.playlists.length!==manifest.settings.playlists.length)throw new Error('备份包含无效或重复曲目/歌单，不能静默舍弃。');
    if(resourceIds.size!==referencedAssets(safe).size)throw new Error('备份资源清单包含未知引用，未导入。');
    for(const id of referencedAssets(safe))if(!resourceIds.has(id))throw new Error('备份缺少有效曲库引用的资源。');
    const binary=row=>verified.get(row.path).slice(0,row.bytes,row.type);
    const hydrated=manifest.projects.map(project=>{
        const row={...pick(project,['id','title','format','updatedAt','revision','runtimeVersion','editRevision']),sourceSettings:pick(project.sourceSettings,SOURCE_KEYS),form:pick(project.form,FORM_KEYS),assets:{},tracks:project.tracks.map(track=>{
            const copy=trackMetadata(track,warnings);if(track.exportUrl)copy.exportUrl=cleanUrl(track.exportUrl,warnings);
            for(const key of ['exportBlob','exportCover'])if(track[key])copy[key]=binary(track[key]);
            if(track.kind==='local'&&!copy.exportBlob&&!copy.exportUrl)throw new Error('项目音频引用不完整。');return copy;
        })};
        for(const key of ['imageBlob','imageOriginalBlob','fontBlob'])if(project.assets?.[key])row.assets[key]=binary(project.assets[key]);
        return row;
    });
    return {manifest:{...manifest,settings:safe,warnings:[...warnings]},projects:hydrated,assets:manifest.resources.map(row=>[row.id,binary(row)]),hash:digest.sha256,bytes:file.size,remoteTracks:safe.tracks.filter(t=>t.kind!=='local').length};
}
