import {normalizeSettings,createTrackId,MAX_TRACKS,MAX_PLAYLISTS} from '../core.js';
import {MAX_FONTS} from '../fonts.js';
import {referencedAssets} from '../asset-retirement.js';
import {canonical} from './backup.js';
import {checksum,hashText} from './checksum.js';
import {normalizeDesign} from '../ui/config.js';
const cloneSettings=settings=>JSON.parse(JSON.stringify(normalizeSettings(settings)));
export const settingsHash=settings=>hashText(canonical(cloneSettings(settings)));
export const projectVersions=projects=>canonical(projects.map(p=>[p.id,p.revision||0]).sort(([a],[b])=>a.localeCompare(b)));
// Completed recovery metadata must not retain another full copy of lyrics/settings forever.
const completedRecord=(op,stage)=>({id:op.id,kind:op.kind||'restore',stage,createdAt:op.createdAt,completedAt:Date.now(),resourceCount:op.assets?.length||0,projectCount:op.projectIds?.length||0});
export async function makeRestorePlan({backup,current,store,projects=[],mode='merge',restorePreferences=false,bindingMap={},signal,onProgress=()=>{}}) {
    if(!['merge','missing','copy'].includes(mode))throw new Error('请选择受支持的恢复方式。');
    const before=cloneSettings(current),after=cloneSettings(current),incoming=backup.manifest.settings;
    const blobs=new Map(await store.entries()),source=new Map(backup.assets),refs=referencedAssets(before),assetIds=new Map(),trackIds=new Map(),playlistIds=new Map();
    const byHash=new Map(),fontHashes=new Map(),existingDigests=new Map();
    let done=0;
    for(const track of before.tracks.filter(t=>t.kind==='local'))if(blobs.has(track.id)){
        const digest=await checksum(blobs.get(track.id),{signal});byHash.set(digest.sha256,track.id);existingDigests.set(track.id,digest.sha256);onProgress({phase:'duplicates',done:++done,total:before.tracks.length});
    }
    for(const font of before.fonts)if(blobs.has(font.id))fontHashes.set((await checksum(blobs.get(font.id),{signal})).sha256,font.id);
    const resourceRows=new Map(backup.manifest.resources.map(row=>[row.id,row]));
    for(const id of resourceRows.keys())if(refs.has(id)&&!blobs.has(id))assetIds.set(id,id);
    const mappedAsset=id=>{
        if(!id)return id;
        if(assetIds.has(id))return assetIds.get(id);
        if(id.endsWith(':original')){const value=mappedAsset(id.slice(0,-9))+':original';assetIds.set(id,value);return value;}
        const prefix=id.startsWith('cover:')?'cover:':id.startsWith('background:')?'background:':id.startsWith('font:')?'font:':'';
        const value=refs.has(id)&&!blobs.has(id)?id:prefix+createTrackId();assetIds.set(id,value);if(prefix==='background:'&&source.has(id+':original'))assetIds.set(id+':original',value+':original');return value;
    };
    const summary={mode,tracksAdded:0,duplicateAudio:0,trackConflicts:0,playlistsAdded:0,playlistsMerged:0,projectsAdded:0,projectConflicts:0,skippedProjects:0,bindingsUnmapped:0,remoteTracks:backup.remoteTracks};
    const usedTrackIds=new Set(after.tracks.map(t=>t.id));
    for(const track of incoming.tracks){
        const old=before.tracks.find(t=>t.id===track.id),row=resourceRows.get(track.id);
        let existing=null;
        if(mode==='missing'&&old)existing=old.id;
        else if(track.kind==='platform'&&old)existing=old.id;
        else if(mode!=='copy'&&track.kind==='local'&&byHash.has(row?.sha256)){existing=byHash.get(row.sha256);summary.duplicateAudio++;}
        else if(mode!=='copy'&&track.kind==='url')existing=before.tracks.find(t=>t.kind==='url'&&t.url===track.url)?.id;
        if(old)summary.trackConflicts++;
        if(existing){
            trackIds.set(track.id,existing);
            if(track.kind==='local')assetIds.set(track.id,existing);
            continue;
        }
        const id=track.kind==='platform'?track.id:mode==='copy'||usedTrackIds.has(track.id)?createTrackId():track.id;
        usedTrackIds.add(id);trackIds.set(track.id,id);if(track.kind==='local')assetIds.set(track.id,id);
        const copy={...track,id};if(copy.coverId)copy.coverId=mappedAsset(copy.coverId);
        after.tracks.push(copy);summary.tracksAdded++;
    }
    // Preserve referenced default tracks even when the receiving catalog has changed.
    for(const track of backup.manifest.catalog||[]) {
        if(!trackIds.has(track.id)){trackIds.set(track.id,track.id);if(!after.tracks.some(t=>t.id===track.id)&&!current.builtinCatalog?.tracks.some(t=>t.id===track.id)){after.tracks.push({...track});summary.tracksAdded++;}}
    }
    const knownIds=new Set([...after.tracks.map(t=>t.id),...(current.builtinCatalog?.tracks||[]).map(t=>t.id)]);
    for(const playlist of incoming.playlists){
        const old=after.playlists.find(p=>p.id===playlist.id),ids=playlist.trackIds.map(id=>trackIds.get(id)||id);
        if(ids.some(id=>!knownIds.has(id)))throw new Error('备份歌单引用的默认歌曲在当前版本不可用，未舍弃曲目。');
        if(old&&mode==='missing'){playlistIds.set(playlist.id,old.id);continue;}
        if(old&&mode==='merge'){
            old.trackIds=[...new Set([...old.trackIds,...ids])];
            for(const avatar of playlist.characterAvatars){const target=Object.hasOwn(bindingMap,avatar)&&typeof bindingMap[avatar]==='string'?bindingMap[avatar]:null;if(target&&!after.playlists.some(p=>p.id!==old.id&&p.characterAvatars.includes(target))){if(!old.characterAvatars.includes(target))old.characterAvatars.push(target);}else summary.bindingsUnmapped++;}
            playlistIds.set(playlist.id,old.id);summary.playlistsMerged++;continue;
        }
        const id=mode==='copy'||old?createTrackId():playlist.id;playlistIds.set(playlist.id,id);
        let name=playlist.name,suffix=1;while(after.playlists.some(p=>p.name===name)){const tag=` · 恢复 ${suffix++}`;name=playlist.name.slice(0,80-tag.length)+tag;}
        const bindings=[];
        for(const avatar of playlist.characterAvatars){
            const target=Object.hasOwn(bindingMap,avatar)&&typeof bindingMap[avatar]==='string'?bindingMap[avatar]:null;
            if(target&&!after.playlists.some(p=>p.characterAvatars.includes(target))&&!bindings.includes(target))bindings.push(target);else summary.bindingsUnmapped++;
        }
        after.playlists.push({...playlist,id,name,trackIds:ids,lastTrackId:trackIds.get(playlist.lastTrackId)||ids[0]||null,characterAvatars:bindings,...(playlist.coverId?{coverId:mappedAsset(playlist.coverId)}:{})});summary.playlistsAdded++;
    }
    for(const font of incoming.fonts){
        const row=resourceRows.get(font.id);if(!row)throw new Error('备份字体文件缺失。');
        if(after.fonts.some(f=>f.id===font.id)&&!blobs.has(font.id)){assetIds.set(font.id,font.id);continue;}
        const existing=fontHashes.get(row.sha256);
        if(existing&&mode!=='copy')assetIds.set(font.id,existing);
        else {const id=mappedAsset(font.id);after.fonts.push({...font,id,hash:row.sha256});fontHashes.set(row.sha256,id);}
    }
    const mappedDesign=value=>{const copy=normalizeDesign(value);if(copy.customization.iconId)copy.customization.iconId=mappedAsset(copy.customization.iconId);return copy;};
    summary.designsAdded=0;summary.designConflicts=0;
    for(const design of incoming.designs||[]){
        const conflict=after.designs.some(row=>row.id===design.id);if(conflict)summary.designConflicts++;
        if(conflict&&mode==='missing')continue;
        after.designs.push({id:conflict||mode==='copy'?'design:'+createTrackId():design.id,name:(design.name+(conflict?' · 恢复':'')).slice(0,80),config:mappedDesign(design.config)});summary.designsAdded++;
    }
    for(const row of incoming.roleDesigns||[]){
        const avatar=Object.hasOwn(bindingMap,row.avatar)&&typeof bindingMap[row.avatar]==='string'?bindingMap[row.avatar]:null;
        if(!avatar){summary.bindingsUnmapped++;continue;}
        const old=after.roleDesigns.find(item=>item.avatar===avatar);
        if(!old)after.roleDesigns.push({avatar,config:mappedDesign(row.config)});
        else if(restorePreferences&&mode!=='missing')old.config=mappedDesign(row.config);
    }
    if(restorePreferences){
        for(const [key,value] of Object.entries(incoming))if(!['tracks','playlists','fonts','favorites','designs','roleDesigns','uiDesign','personalDesign','recentPlays','playEvents','backgroundId','fontId','fontName','fontPreset','activePlaylistId','currentId'].includes(key))after[key]=structuredClone(value);
        after.uiDesign=mappedDesign(incoming.uiDesign);
        after.personalDesign=incoming.personalDesign?mappedDesign(incoming.personalDesign):null;
        after.backgroundId=incoming.backgroundId?mappedAsset(incoming.backgroundId):null;
        after.fontId=incoming.fontId?mappedAsset(incoming.fontId):null;after.fontPreset=incoming.fontPreset;after.fontName=incoming.fontName;
        after.activePlaylistId=playlistIds.get(incoming.activePlaylistId)||null;after.currentId=trackIds.get(incoming.currentId)||after.tracks[0]?.id||null;
    }
    for(const key of ['recentPlays','playEvents'])after[key]=[...after[key],...incoming[key].map(event=>({...event,trackId:trackIds.get(event.trackId)||event.trackId}))].filter((row,i,all)=>all.findIndex(other=>other.trackId===row.trackId&&other.at===row.at)===i);
    // Merge through the actual restore ID map (including independent-copy and audio dedup).
    for(const row of incoming.favorites || []) {
        const trackId=trackIds.get(row.trackId)||row.trackId;
        if(!after.favorites.some(item=>item.trackId===trackId))after.favorites.push({...row,trackId});
    }
    const projectWrites=[];
    for(const project of backup.projects){
        const conflict=projects.some(p=>p.id===project.id);if(conflict)summary.projectConflicts++;
        if(conflict&&mode==='missing'){summary.skippedProjects++;continue;}
        const id=conflict||mode==='copy'?'rscp:'+createTrackId():project.id;
        const copy=structuredClone(project);copy.id=id;copy.revision=1;
        if(conflict)copy.title=(String(copy.title||'项目').slice(0,65)+' · 恢复');
        copy.form['stm-maker-title']=copy.title;copy.form['stm-maker-collection']=playlistIds.get(copy.form['stm-maker-collection'])||copy.form['stm-maker-collection']||'';
        for(const track of copy.tracks){if(trackIds.has(track.id))track.id=trackIds.get(track.id);if(track.coverId&&assetIds.has(track.coverId))track.coverId=assetIds.get(track.coverId);}
        for(const key of ['backgroundId','fontId'])if(assetIds.has(copy.sourceSettings[key]))copy.sourceSettings[key]=assetIds.get(copy.sourceSettings[key]);
        if(copy.sourceSettings.uiDesign)copy.sourceSettings.uiDesign=mappedDesign(copy.sourceSettings.uiDesign);
        projectWrites.push(copy);summary.projectsAdded++;
    }
    if(after.tracks.length>MAX_TRACKS||after.playlists.length>MAX_PLAYLISTS||after.fonts.length>MAX_FONTS)throw new Error(`恢复后将有 ${after.tracks.length} 首歌曲、${after.playlists.length} 个歌单、${after.fonts.length} 款字体，超过现有限制（200 / 50 / 20）；未写入或舍弃内容，请改选仅恢复缺失内容或调整后重试。`);
    if(after.designs.length>30||after.roleDesigns.length>1000)throw new Error('恢复后设计数量超过当前支持范围，未写入或舍弃设计；请改选仅恢复缺失内容。');
    const assetWrites=[];
    // Plan before writing. Reused existing bytes are never overwritten or scheduled for rollback.
    const planned=new Map();for(const [old,id] of assetIds)if(source.has(old)&&!blobs.has(id))planned.set(id,source.get(old));
    const finalRefs=referencedAssets(after);
    for(const [id,blob] of planned)if(finalRefs.has(id))assetWrites.push([id,blob]);
    for(const id of finalRefs)if(!blobs.has(id)&&!assetWrites.some(([key])=>key===id))throw new Error('恢复后仍有缺失资源引用；当前曲库与备份均未修改。');
    const checked=normalizeSettings(after);
    if(checked.tracks.length!==after.tracks.length||checked.playlists.length!==after.playlists.length||checked.fonts.length!==after.fonts.length)throw new Error('恢复计划会丢弃无效或冲突项目，已阻止执行。');
    const reusedAssets=[];
    for(const id of finalRefs)if(blobs.has(id))reusedAssets.push({id,bytes:blobs.get(id).size,sha256:existingDigests.get(id)||(await checksum(blobs.get(id),{signal})).sha256});
    return {before,after:JSON.parse(JSON.stringify(checked)),beforeHash:settingsHash(before),afterHash:settingsHash(checked),projectVersions:projectVersions(projects),reusedAssets,assetWrites,projectWrites,summary,bytesToWrite:assetWrites.reduce((n,[,b])=>n+b.size,0)+projectWrites.reduce((n,p)=>n+p.tracks.reduce((v,t)=>v+(t.exportBlob?.size||0)+(t.exportCover?.size||0),0)+(p.assets?.imageBlob?.size||0)+(p.assets?.imageOriginalBlob?.size||0)+(p.assets?.fontBlob?.size||0)+(p.assets?.iconBlob?.size||0),0)};
}
export async function verifyReferences(settings,store,projects=[]) {
    const missing=[];
    for(const id of referencedAssets(settings))if(!(await store.get(id) instanceof Blob))missing.push(id);
    for(const project of projects)for(const track of project.tracks||[])if(track.kind==='local'&&!track.exportBlob&&!track.exportUrl&&!(await store.get(track.id) instanceof Blob))missing.push(`project:${project.id}`);
    if(missing.length)throw new Error(`恢复引用核对失败：${missing.length} 项资源缺失；暂存内容已保留，请勿清空浏览器。`);
    return {passed:true,resources:referencedAssets(settings).size,projects:projects.length};
}
/** All stores are account-scoped. No existing bytes/projects are overwritten. */
export async function applyRestore({plan,store,projects,journal,settings,commitSettings,assertAccount=async()=>{},signal,onProgress=()=>{}}) {
    await assertAccount();signal?.throwIfAborted();
    if(settingsHash(settings)!==plan.beforeHash||projectVersions(await projects.list())!==plan.projectVersions)throw new Error('预览后曲库或项目已改变，请重新预览；未写入。');
    for(const row of plan.reusedAssets||[]){const blob=await store.get(row.id);if(!(blob instanceof Blob)||blob.size!==row.bytes||(await checksum(blob,{signal})).sha256!==row.sha256)throw new Error('预览后已有资源发生变化，请重新预览；未写入。');}
    const op={id:'restore:'+createTrackId(),kind:'restore',stage:'prepared',createdAt:Date.now(),before:plan.before,after:plan.after,assets:[],projectIds:plan.projectWrites.map(p=>p.id)};
    for(const [id,blob] of plan.assetWrites)op.assets.push({id,...await checksum(blob,{signal})});
    await journal.put(op);
    try {
        await store.putMany(plan.assetWrites,{ifAbsent:true,owner:op.id});op.stage='assets-staged';await journal.put(op);onProgress({phase:'assets-staged'});
        signal?.throwIfAborted();await projects.putNew(plan.projectWrites.map(project=>({...project,_restoreOperation:op.id})));op.stage='projects-staged';await journal.put(op);onProgress({phase:'projects-staged'});
        await verifyReferences(plan.after,store,plan.projectWrites);await assertAccount();signal?.throwIfAborted();
        if(settingsHash(settings)!==plan.beforeHash)throw new Error('暂存期间设置已改变，未覆盖新编辑。');
        op.stage='publishing';await journal.put(op);onProgress({phase:'publishing'});
        const result=await commitSettings(plan.after,plan.before);
        if(result!=='confirmed')throw new Error('服务器保存结果尚未确认；暂存资源和恢复记录已保留，请重新核对。');
        op.stage='committed';await journal.put(op);
        const verification=await verifyReferences(plan.after,store,await projects.list());
        op.stage='complete';await journal.put(completedRecord(op,'complete'));onProgress({phase:'complete'});
        return {operation:op.id,verification};
    } catch(error) {
        // Never guess that a failed/aborted HTTP response means the server did not commit.
        op.error='恢复未完成，需核对服务器与暂存记录。';op.stage=op.stage==='publishing'||op.stage==='committed'?'needs-review':'staging-failed';
        await journal.put(op).catch(()=>{});
        if(op.stage==='staging-failed') {
            // Pre-publication rollback removes only newly created resources, matching checksums.
            await rollbackStaging({op,store,projects,journal,protectedSettings:settings}).catch(()=>{});
        }
        throw error;
    }
}
export async function rollbackStaging({op,store,projects,journal,protectedSettings}) {
    const refs=referencedAssets(protectedSettings);
    let retained=0;
    for(const id of op.projectIds){const p=await projects.get(id);if(p?._restoreOperation===op.id){if(p.revision===1)await projects.delete(id,1);else retained++;}}
    for(const project of await projects.list()) {
        for(const track of project.tracks||[]){if(track.kind==='local')refs.add(track.id);if(track.coverId)refs.add(track.coverId);}
        for(const key of ['backgroundId','fontId'])if(project.sourceSettings?.[key]){refs.add(project.sourceSettings[key]);if(key==='backgroundId')refs.add(project.sourceSettings[key]+':original');}
    }
    const remove=[];
    for(const row of op.assets){
        if(await store.owner(row.id)!==op.id)continue;
        const blob=await store.get(row.id);if(!blob)continue;
        if(refs.has(row.id)||blob.size!==row.bytes||(await checksum(blob)).sha256!==row.sha256){retained++;continue;}remove.push(row.id);
    }
    await store.deleteMany(remove);
    op.stage=retained?'needs-review':'rolled-back';op.retained=retained;await journal.put(retained?op:completedRecord(op,'rolled-back'));
    return {removed:remove.length,retained};
}
export async function recoverRestore({op,remote,store,projects,journal,localSettings}) {
    const actual=settingsHash(remote);
    if(actual===settingsHash(op.after)) {await verifyReferences(op.after,store,await projects.list());op.stage='complete';await journal.put(completedRecord(op,'complete'));return {status:'confirmed'};}
    if(actual===settingsHash(op.before)) {
        const result=await rollbackStaging({op,store,projects,journal,protectedSettings:localSettings&&settingsHash(localSettings)!==settingsHash(op.after)?localSettings:remote});
        return {status:result.retained?'needs-review':'rolled-back',...result};
    }
    return {status:'needs-review',reason:'服务器内容与恢复前后快照均不同；没有自动覆盖或删除任何数据。'};
}
