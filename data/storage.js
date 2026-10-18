import {referencedAssets} from '../asset-retirement.js';
import {canonical} from './backup.js';
import {hashText} from './checksum.js';
import {designReferences} from '../ui/config.js';
export function referenceGraph(settings,projects,operations=[]) {
    const refs=referencedAssets(settings);let unknown=false;
    for(const project of projects){
        if(project.format!==1||!Array.isArray(project.tracks)||!project.sourceSettings)unknown=true;
        for(const track of project.tracks||[]){if(track.kind==='local')refs.add(track.id);if(track.coverId)refs.add(track.coverId);}
        const bg=project.sourceSettings?.backgroundId;if(bg){refs.add(bg);refs.add(bg+':original');}
        if(project.sourceSettings?.fontId)refs.add(project.sourceSettings.fontId);
        for(const id of designReferences(project.sourceSettings))refs.add(id);
    }
    for(const op of operations)if(!['complete','rolled-back'].includes(op.stage)){
        for(const id of referencedAssets(op.before)||[])refs.add(id);
        for(const id of referencedAssets(op.after)||[])refs.add(id);
        for(const asset of op.assets||[])refs.add(asset.id);
    }
    return {refs,unknown};
}
export async function storageSnapshot({settings,store,projects,journal,estimate=()=>navigator.storage.estimate()}) {
    const [entries,rows,operations,retired,quota]=await Promise.all([store.entries(),projects.list(),journal.list(),journal.list('retired'),estimate().catch(()=>null)]);
    const graph=referenceGraph(settings,rows,operations),byId=new Map(entries),totals={audio:0,covers:0,backgrounds:0,fonts:0,drafts:0,retired:0,unknown:0};
    const knownRetired=new Set(retired.map(r=>r.id)),local=new Set(settings.tracks.filter(t=>t.kind==='local').map(t=>t.id));
    for(const [id,blob] of entries){
        if(!(blob instanceof Blob)){graph.unknown=true;continue;}
        if(knownRetired.has(id)&&!graph.refs.has(id))totals.retired+=blob.size;
        else if(local.has(id))totals.audio+=blob.size;
        else if(id.startsWith('cover:'))totals.covers+=blob.size;
        else if(id.startsWith('background:'))totals.backgrounds+=blob.size;
        else if(id.startsWith('font:'))totals.fonts+=blob.size;
        else totals.unknown+=blob.size;
    }
    for(const p of rows){for(const t of p.tracks||[])totals.drafts+=(t.exportBlob?.size||0)+(t.exportCover?.size||0);totals.drafts+=(p.assets?.imageBlob?.size||0)+(p.assets?.imageOriginalBlob?.size||0)+(p.assets?.fontBlob?.size||0)+(p.assets?.iconBlob?.size||0);}
    const candidates=graph.unknown?[]:retired.filter(r=>r.confirmed===true&&!graph.refs.has(r.id)&&byId.get(r.id) instanceof Blob).map(r=>({id:r.id,bytes:byId.get(r.id).size}));
    return {totals,quota,candidates,unknownReferences:graph.unknown,pending:operations.filter(op=>!['complete','rolled-back'].includes(op.stage)),fingerprint:hashText(canonical({settings,projects:rows.map(p=>[p.id,p.revision]),retired,entries:entries.map(([id,b])=>[id,b.size||0])}))};
}
export async function cleanRetired({preview,settings,store,projects,journal,readRemote,assertAccount,estimate}) {
    await assertAccount();
    const current=await storageSnapshot({settings,store,projects,journal,estimate});
    if(current.fingerprint!==preview.fingerprint)throw new Error('扫描后数据已改变，请重新生成清理预览。');
    const remote=await readRemote(),remoteRefs=referencedAssets(remote);
    if(!remoteRefs||current.unknownReferences||current.pending.length)throw new Error('存在未知引用或未完成恢复，未删除任何资源。');
    const ids=current.candidates.filter(row=>!remoteRefs.has(row.id)).map(row=>row.id);
    if(ids.length!==preview.candidates.length)throw new Error('服务器仍引用部分资源，请重新扫描；未删除。');
    // No other account database or legacy database is opened/deleted here.
    const last=await storageSnapshot({settings,store,projects,journal,estimate});
    if(last.fingerprint!==preview.fingerprint)throw new Error('删除前数据再次改变，已取消清理。');
    await store.deleteMany(ids);
    for(const id of ids){if(await store.get(id)!==undefined)throw new Error('清理核对未完成，请重新扫描。');await journal.delete(id,'retired');}
    return {removed:ids.length,bytes:preview.candidates.reduce((n,row)=>n+row.bytes,0)};
}
export async function checkCapacity(bytes,estimate=()=>navigator.storage.estimate()) {
    const result=await estimate().catch(()=>null);
    if(result&&Number.isFinite(result.quota)&&Number.isFinite(result.usage)&&result.quota-result.usage<bytes*1.15+1024*1024)throw new Error('浏览器估算的剩余空间不足以安全暂存本次恢复；原数据未清空。请释放空间或换浏览器后重试。');
    return {estimate:result,bytes,estimatedOnly:true};
}
