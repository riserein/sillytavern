import {createBackup,inspectBackup} from './backup.js';
import {makeRestorePlan,applyRestore,recoverRestore} from './restore.js';
import {createSettingsCommitter} from './settings-commit.js';
import {storageSnapshot,cleanRetired,checkCapacity,referenceGraph} from './storage.js';
import {legacySummary,legacyProjects,prepareLegacyCopy} from './legacy.js';
import {CardProjectStore} from '../card-player/project-store.js';
import {createSelectMenus} from '../select-menu.js';
const size=n=>`${(n/1048576).toFixed(2)} MiB`;
export function createDataPanel({panel,settings,store,journal,context,account,assertAccount,flushMaker=async()=>{},pausePlayback=()=>{},setMaintenanceBusy=()=>{}}) {
    const root=document.createElement('details');root.className='stm-data-tools';root.dataset.role='data-tools';
    root.innerHTML=`<summary>数据备份与恢复</summary><p class="stm-hint" data-data="identity"></p>
    <p class="stm-hint">完整备份包含当前账号曲库、本地原文件、歌词、歌单与绑定、图片、字体、外观、历史及全部已保存制作草稿。远程音频只保存信息和链接。</p>
    <button type="button" class="stm-secondary" data-data="backup">导出完整备份 ZIP</button>
    <button type="button" class="stm-secondary" data-data="choose">选择备份文件</button><input type="file" data-data="file" accept=".zip,application/zip" hidden>
    <section data-data="restore" hidden><label>恢复方式<select id="stm-restore-mode" data-data="mode"><option value="merge">合并：保留已有信息，补入新内容</option><option value="missing">仅恢复缺失：不覆盖已有条目</option><option value="copy">独立副本：新歌曲、歌单和项目 ID</option></select></label>
    <label class="stm-check-label"><input type="checkbox" data-data="preferences">同时恢复备份中的外观、阅读偏好、音量、模式和窗口位置</label>
    <p class="stm-hint">重复音频按真实字节识别；合并保留现有歌曲信息，要保留两份不同编辑请选择独立副本。同一平台歌曲按平台标识复用。角色绑定须在下方核对，不按旧编号自动绑定。</p>
    <div data-data="bindings"></div><button type="button" class="stm-secondary" data-data="preview">核对恢复计划</button><pre class="stm-hint" data-data="preview-text"></pre><button type="button" class="stm-primary" data-data="apply" disabled>确认恢复</button></section>
    <details><summary>旧设备数据归属确认</summary><p class="stm-hint" data-data="legacy-count">正在检查旧库…</p><label class="stm-check-label"><input type="checkbox" data-data="ownership">我确认旧库中待选择的数据属于当前账号</label><button type="button" class="stm-secondary" data-data="legacy-preview">显示旧草稿并选择</button><div data-data="legacy-projects"></div><button type="button" class="stm-secondary" data-data="legacy-copy" disabled>预览复制到当前账号</button><p class="stm-hint">只复制所选旧草稿及当前曲库所引用的文件。原数据库不删除、不改名、不清空；其他账号数据不会自动认领。</p></details>
    <details><summary>存储空间</summary><button type="button" class="stm-secondary" data-data="scan">扫描空间与安全清理预览</button><pre class="stm-hint" data-data="storage-text"></pre><button type="button" class="stm-secondary" data-data="clean" disabled>确认清理预览中的资源</button><button type="button" class="stm-secondary" data-data="persist">申请保留浏览器存储</button><p class="stm-hint">各分类显示逻辑文件字节，草稿副本另计；浏览器配额是整个站点估算，不能当作当前账号专属空间。未知、其他账号、旧库及保存未确认的资源不会清理。</p></details>
    <details><summary>未完成恢复记录</summary><button type="button" class="stm-secondary" data-data="recover">核对未完成恢复</button><pre class="stm-hint" data-data="recovery-text"></pre></details>
    <progress data-data="progress" max="1" value="0" aria-label="数据操作进度" hidden></progress><button type="button" class="stm-secondary" data-data="cancel" hidden>取消当前操作</button>
    <p class="stm-hint" role="status" aria-live="polite" data-data="status"></p><button type="button" class="stm-secondary" data-data="reload" hidden>刷新酒馆以应用恢复的数据</button>`;
    panel.querySelector('[data-view=appearance]').append(root);
    const q=name=>root.querySelector(`[data-data="${name}"]`),listeners=new AbortController(),projects=new CardProjectStore();
    let disposed=false,job=null,activePromise=Promise.resolve(),backup=null,plan=null,scan=null,legacyRows=[],bindingMenus=null,lastProgress=0,publishing=false,legacyPreviewed=false;
    const urls=new Set(),timers=new Set(),scope=account?.key;
    const estimate=()=>navigator.storage?.estimate?.()||Promise.resolve(null);
    const committer=createSettingsCommitter({context,settings,assertAccount});
    const menus=createSelectMenus(panel,{controlsRoot:root});
    const status=text=>{if(!disposed)q('status').textContent=text;};
    q('identity').textContent=account?.verified?`当前账号：${account.label} · 独立本地存储。旧库保留，确认归属后才复制。`:'当前账号身份未确认，本地备份、恢复和迁移已锁定；重新登录并刷新后重试。';
    const invalidate=()=>{plan=null;q('apply').disabled=true;q('preview-text').textContent='选项已变化，请重新核对恢复计划。';};
    const progress=row=>{
        if(disposed)return;
        if(row.phase==='publishing'){publishing=true;q('cancel').disabled=true;}
        if(Date.now()-lastProgress<100&&row.phase!=='complete'&&row.phase!=='publishing')return;
        lastProgress=Date.now();q('progress').hidden=false;
        if(row.total){q('progress').max=row.total;q('progress').value=row.done||0;}else q('progress').removeAttribute('value');
        const labels={checksum:'计算资源校验值',verify:'校验备份资源',projects:'整理制作项目',duplicates:'检查重复音频','assets-staged':'资源已暂存','projects-staged':'草稿已暂存',publishing:'等待酒馆确认设置；此阶段不能撤销网络请求',complete:'操作完成'};
        status(`${labels[row.phase]||'正在处理'}${row.total?` · ${row.done||0} / ${row.total}`:''}`);
    };
    function run(task,{mutating=false}={}) {
        if(job||disposed)return activePromise;
        const controller=new AbortController();job=controller;publishing=false;q('cancel').hidden=false;q('cancel').disabled=false;
        const ownButtons=[...root.querySelectorAll('button,input,select')].filter(n=>n!==q('cancel')),states=ownButtons.map(n=>[n,n.disabled]);
        for(const [node]of states)node.disabled=true;
        if(mutating){pausePlayback();setMaintenanceBusy(true);}
        const execute=async()=>{await assertAccount();return task(controller.signal);};
        activePromise=(navigator.locks?navigator.locks.request('riserein:maintenance:'+scope,{signal:controller.signal},execute):execute())
            .catch(error=>{status(error.name==='AbortError'?'操作已取消。已发布或保存结果不明的恢复会保留阶段记录，请重新核对。':error.name==='QuotaExceededError'?'浏览器存储空间不足，原有曲库未清空；请释放空间，并在恢复记录中核对暂存内容。':`未完成：${error.message}`);})
            .finally(()=>{
                job=null;setMaintenanceBusy(false);
                if(!disposed){for(const [node,disabled]of states)node.disabled=disabled;q('cancel').hidden=true;q('cancel').disabled=false;q('progress').hidden=true;q('apply').disabled=!plan;q('clean').disabled=!scan?.candidates.length;q('legacy-copy').disabled=!legacyPreviewed;}
            });
        return activePromise;
    }
    const listen=(name,callback)=>q(name).addEventListener('click',callback,{signal:listeners.signal});
    const download=blob=>{
        const url=URL.createObjectURL(blob);urls.add(url);const link=document.createElement('a');link.href=url;link.download=`music-backup-${new Date().toISOString().slice(0,10)}.zip`;link.click();
        const timer=setTimeout(()=>{URL.revokeObjectURL(url);urls.delete(url);timers.delete(timer);},60000);timers.add(timer);
    };
    function bindings(){
        bindingMenus?.dispose();q('bindings').replaceChildren();
        const avatars=[...new Set([...backup.manifest.settings.playlists.flatMap(list=>list.characterAvatars),...(backup.manifest.settings.roleDesigns||[]).map(row=>row.avatar),...(backup.manifest.settings.roleScenes||[]).map(row=>row.avatar)])];
        const characters=context.characters||[];
        for(const [i,avatar]of avatars.entries()){
            const label=document.createElement('label');label.textContent=`原绑定：${avatar} → `;
            const select=document.createElement('select');select.id='stm-restore-bind-'+i;select.dataset.sourceAvatar=avatar;select.append(new Option('暂不绑定，导入后再选择',''));
            for(const card of characters)select.append(new Option(String(card.name||card.avatar),card.avatar));
            select.addEventListener('change',invalidate,{signal:listeners.signal});label.append(select);q('bindings').append(label);
        }
        bindingMenus=createSelectMenus(panel,{controlsRoot:q('bindings')});
    }
    async function preview(signal){
        if(!backup)throw new Error('请先选择并校验备份文件。');
        await flushMaker();
        const bindingMap=Object.fromEntries([...q('bindings').querySelectorAll('select')].map(node=>[node.dataset.sourceAvatar,node.value]));
        const allowed=new Set((context.characters||[]).map(c=>c.avatar));
        if(Object.values(bindingMap).some(v=>v&&!allowed.has(v)))throw new Error('角色列表已改变，请重新选择绑定。');
        const next=await makeRestorePlan({backup,current:settings,store,projects:await projects.list(),mode:q('mode').value,restorePreferences:q('preferences').checked,bindingMap,signal,onProgress:progress});
        const capacity=await checkCapacity(next.bytesToWrite,estimate);plan=next;
        const s=plan.summary;
        q('preview-text').textContent=`备份：${backup.manifest.settings.tracks.length} 首 / ${backup.manifest.settings.playlists.length} 歌单 / ${backup.projects.length} 项目\n将新增：${s.tracksAdded} 首 / ${s.playlistsAdded} 歌单 / ${s.projectsAdded} 项目 / ${s.designsAdded||0} 设计\n重复音频：${s.duplicateAudio}；歌曲 ID 冲突：${s.trackConflicts}；项目 ID 冲突：${s.projectConflicts}；按所选方式跳过已有项目：${s.skippedProjects}\n未映射或已有冲突的角色绑定：${s.bindingsUnmapped}\n暂存逻辑字节：${size(plan.bytesToWrite)}；${capacity.estimate?'空间估算已检查（仍可能发生配额错误）':'浏览器未提供配额估算，写入仍可能失败'}\n远程歌曲：${s.remoteTracks} 首，仅信息与 URL，不是离线音频\n${backup.manifest.warnings.join('\n')}\n仅在下方确认后写入。已有歌曲和草稿不会被清空或覆盖。`;
        q('apply').disabled=false;status('恢复计划已核对，请检查数量、恢复方式和角色映射后确认。');
    }
    listen('backup',()=>run(async signal=>{
        await flushMaker();const result=await createBackup({settings,store,projects:await projects.list(),signal,onProgress:progress});
        signal.throwIfAborted();download(result.blob);status(`完整备份已生成：${size(result.bytes)}；${result.counts.tracks} 首歌曲、${result.counts.playlists} 个歌单、${result.counts.projects} 个项目。远程歌曲只备份链接。${result.manifest.warnings.join(' ')}`);
    }));
    listen('choose',()=>q('file').click());
    q('file').addEventListener('change',()=>{const file=q('file').files[0];q('file').value='';if(!file)return;void run(async signal=>{
        backup=null;invalidate();backup=await inspectBackup(file,{signal,onProgress:progress});q('restore').hidden=false;q('preferences').checked=!settings.tracks.length;bindings();status(`备份校验通过：${backup.manifest.settings.tracks.length} 首歌曲、${backup.projects.length} 个制作项目。请选择恢复方式并核对计划。`);
    });},{signal:listeners.signal});
    q('mode').addEventListener('change',invalidate,{signal:listeners.signal});q('preferences').addEventListener('change',invalidate,{signal:listeners.signal});
    listen('preview',()=>run(preview));
    listen('apply',()=>{if(!plan||!window.confirm('按已核对计划恢复？现有内容保留；同名或冲突按预览处理。恢复期间请勿切换账号或关闭页面。'))return;
        void run(async signal=>{const current=plan;plan=null;await checkCapacity(current.bytesToWrite,estimate);await applyRestore({plan:current,store,projects,journal,settings,commitSettings:committer.commit,assertAccount,signal,onProgress:progress});scan=null;q('reload').hidden=false;status('恢复完成，资源引用与酒馆保存已核对。点击“刷新酒馆”应用曲库和外观；原有数据未清空。');},{mutating:true});
    });
    listen('legacy-preview',()=>run(async()=>{
        if(!q('ownership').checked)throw new Error('请先确认待选择的旧数据属于当前账号。');
        legacyRows=await legacyProjects();legacyPreviewed=true;q('legacy-projects').replaceChildren();
        for(const row of legacyRows){const label=document.createElement('label');label.className='stm-check-label';const input=document.createElement('input');input.type='checkbox';input.dataset.projectId=row.id;label.append(input,document.createTextNode(String(row.title||'未命名旧项目')));q('legacy-projects').append(label);}
        q('legacy-copy').disabled=false;status(`已读取 ${legacyRows.length} 个旧草稿，请只选择属于当前账号的项目。当前曲库引用的旧文件也会纳入复制预览。`);
    }));
    listen('legacy-copy',()=>run(async signal=>{
        if(!q('ownership').checked)throw new Error('旧数据归属尚未确认。');
        const selected=new Set([...q('legacy-projects').querySelectorAll('input:checked')].map(n=>n.dataset.projectId));
        backup=await prepareLegacyCopy({settings,store,selectedProjects:legacyRows.filter(p=>selected.has(p.id)),signal,onProgress:progress});
        q('restore').hidden=false;q('mode').value='missing';q('preferences').checked=false;menus.refresh();bindings();await preview(signal);
        status('旧库复制计划已生成。请核对并点击确认恢复；旧数据库始终保留。');
    }));
    listen('scan',()=>run(async()=>{
        await flushMaker();scan=await storageSnapshot({settings,store,projects,journal,estimate});
        const t=scan.totals;q('storage-text').textContent=`本地音频：${size(t.audio)}\n歌曲/歌单封面：${size(t.covers)}\n背景与原图：${size(t.backgrounds)}\n自定义字体：${size(t.fonts)}\n制作草稿内嵌副本：${size(t.drafts)}\n待回收资源：${size(t.retired)}\n未知/其他资源：${size(t.unknown)}（保留）\n${scan.quota?`整个站点已用 / 配额估算：${size(scan.quota.usage||0)} / ${size(scan.quota.quota||0)}`:'浏览器未提供空间估算'}\n可安全清理预览：${scan.candidates.length} 项，${size(scan.candidates.reduce((n,r)=>n+r.bytes,0))}\n${scan.unknownReferences?'检测到未知引用，清理已锁定。':''}${scan.pending.length?'有未完成恢复，清理已锁定。':''}`;
        if(scan.pending.length)scan.candidates=[];q('clean').disabled=!scan.candidates.length;status('扫描完成；未删除任何资源。清理需再次确认与校验。');
    }));
    listen('clean',()=>{if(!scan?.candidates.length||!window.confirm(`清理已预览的 ${scan.candidates.length} 项未引用且保存已确认资源？其他及未知文件保留。`))return;
        void run(async()=>{const result=await cleanRetired({preview:scan,settings,store,projects,journal,readRemote:committer.remote,assertAccount,estimate});scan=null;status(`安全清理完成：${result.removed} 项，${size(result.bytes)}。`);},{mutating:true});
    });
    listen('persist',()=>run(async()=>{const granted=await navigator.storage?.persist?.();status(granted?'浏览器已授予存储保留；仍需定期导出备份，不能抵御主动清除站点数据。':'浏览器未授予或不支持存储保留，请定期导出完整备份。');}));
    listen('recover',()=>run(async()=>{
        const operations=(await journal.list()).filter(op=>!['complete','rolled-back'].includes(op.stage));const lines=[];
        for(const op of operations){await assertAccount();const result=await recoverRestore({op,remote:await committer.remote(),store,projects,journal,localSettings:settings});lines.push(`${op.id}：${result.status}${result.reason?' · '+result.reason:''}`);}
        q('recovery-text').textContent=lines.join('\n')||'没有未完成恢复。';if(operations.length)q('reload').hidden=false;status('恢复记录核对完成；不明确的阶段继续保留，不自动覆盖服务器。');
    },{mutating:true}));
    listen('cancel',()=>{if(!publishing)job?.abort();});listen('reload',()=>{if(window.confirm('刷新酒馆会中断当前生成中的回复。现在刷新以应用恢复数据？'))location.reload();});
    if(!account?.verified){q('legacy-count').textContent='账号未确认，未读取旧库。';for(const n of root.querySelectorAll('button,input,select'))n.disabled=true;}
    else void legacySummary().then(summary=>{
        if(!disposed){q('legacy-count').textContent=`检测到旧库资源记录 ${summary.resources} 项、旧草稿 ${summary.projects} 个。未认领前不会显示旧草稿标题或自动迁移。`;if(summary.resources||summary.projects)status('检测到未认领旧库。原文件没有消失；如属于当前账号，请展开归属确认并预览复制。');}
    }).catch(()=>{if(!disposed)q('legacy-count').textContent='旧库检查暂未完成，原数据未改动。';});
    return {async protectedReferences(){return referenceGraph(settings,await projects.list(),await journal?.list()||[]);},dispose(){
        disposed=true;job?.abort();listeners.abort();committer.dispose();menus.dispose();bindingMenus?.dispose();for(const timer of timers)clearTimeout(timer);for(const url of urls)URL.revokeObjectURL(url);urls.clear();backup=null;plan=null;scan=null;
        void activePromise.catch(()=>{}).then(()=>Promise.all([projects.dispose(),journal?.close()]));root.remove();
    }};
}
