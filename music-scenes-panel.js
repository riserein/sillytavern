import { createTrackId, playlistForCharacter } from './core.js';
import { allTracks } from './platforms/library.js';
import { DESIGN_THEMES } from './ui/config.js';
import { normalizeSceneSet, roleSceneGroup, saveRoleScenes, sceneIssues, sceneAssetReferences, textLength, MAX_SCENES } from './music-scenes.js';
import { prepareCover } from './media.js';
import { createSelectMenus } from './select-menu.js';
import { validateImageFile } from './background.js';

const button = (doc,text,action,id) => { const b=doc.createElement('button');b.type='button';b.className='stm-secondary';b.textContent=text;b.dataset.sceneAction=action;if(id)b.dataset.id=id;return b; };

/** One shared, delegated picker. No audio or account storage of its own. */
export function createScenePicker({panel,getGroup,getCurrent,onChoose,onManage,onError}) {
    const doc=panel.ownerDocument,abort=new AbortController(),bar=doc.createElement('div');bar.className='stm-scene-bar';
    bar.innerHTML='<button type="button" class="stm-secondary" data-scene-open>场景 <span></span> ▾</button><p class="stm-hint" data-scene-description></p>';
    panel.querySelector('[data-view=playback]').prepend(bar);
    const overlay=doc.createElement('section');overlay.className='stm-queue-overlay';overlay.hidden=true;overlay.setAttribute('aria-label','音乐场景');
    overlay.innerHTML='<div class="stm-queue-scrim" data-scene-close></div><div class="stm-queue-sheet"><header><h3>音乐场景</h3><button type="button" class="stm-icon" data-scene-close aria-label="关闭音乐场景">×</button></header><p class="stm-hint">选择此刻的配乐；暂停时切换也会保持暂停。</p><div class="stm-scene-choices"></div></div>';
    panel.append(overlay);let returnFocus=null;
    function close(){overlay.hidden=true;returnFocus?.focus({preventScroll:true});returnFocus=null;}
    bar.addEventListener('click',()=>{returnFocus=doc.activeElement;refresh();overlay.hidden=false;overlay.querySelector('button')?.focus();},{signal:abort.signal});
    overlay.addEventListener('click',event=>{if(event.target.closest('[data-scene-close]'))return close();const b=event.target.closest('[data-scene-action]');if(!b)return;if(b.dataset.sceneAction==='manage'){close();onManage?.();return;}Promise.resolve(onChoose(b.dataset.id)).then(close).catch(onError);},{signal:abort.signal});
    overlay.addEventListener('keydown',e=>{if(e.key==='Escape'){e.stopPropagation();close();}},{signal:abort.signal});
    function refresh(){
        const group=getGroup(),current=getCurrent();bar.hidden=!group?.scenes.length;
        bar.querySelector('span').textContent=current?.name||'选择配乐';bar.querySelector('p').textContent=current?.description||'';
        const target=overlay.querySelector('.stm-scene-choices');target.replaceChildren();
        for(const scene of group?.scenes||[]){const b=button(doc,scene.name,'choose',scene.id);
            // Validity is supplied by group so a standalone preview needs no host settings.
            b.disabled=scene.playable===false;b.setAttribute('aria-pressed',String(scene.id===current?.id));
            const small=doc.createElement('small');small.textContent=scene.playable===false?'草稿 · 请先补全歌曲':`${scene.trackIds.length} 首${scene.id===group.defaultSceneId?' · 作者默认':''}`;b.append(small);target.append(b);
        }
        if(onManage)target.append(button(doc,'管理当前角色的音乐场景','manage'));
    }
    refresh();return {refresh,close,bar,dispose(){abort.abort();overlay.remove();bar.remove();}};
}

/** Author-only editor. Draft metadata and uploaded bytes stay isolated until
 * explicit save; preview never publishes the draft or a personal scene choice. */
export function createSceneManager({panel,settings,store,getContext,save,onSaved,onPreview,onError}) {
    const doc=panel.ownerDocument,abort=new AbortController(),root=doc.createElement('section');root.className='stm-scene-manager';root.hidden=true;
    root.innerHTML='<div class="stm-maker-scroll"><header class="stm-maker-header"><h3>角色音乐场景</h3><button type="button" class="stm-secondary" data-scene-action="close">关闭</button></header><p class="stm-hint">为同一角色安排不同配乐。歌曲引用现有曲库，不复制音频；草稿只有点击保存才写入。</p><label>绑定角色<select data-scene-role></select></label><div class="stm-scene-editor-list"></div><div><button type="button" class="stm-secondary" data-scene-action="new">＋ 新建场景</button><button type="button" class="stm-secondary" data-scene-action="copy">复制场景</button><button type="button" class="stm-secondary" data-scene-action="delete">删除场景</button></div><div data-scene-fields><label>场景名称<input data-scene-field="name" required></label><label>场景介绍 · 最多 300 字<textarea data-scene-field="description" rows="3"></textarea><output data-scene-counter></output></label><label>主题色<select data-scene-field="themeId"></select></label><label class="stm-check-label"><input type="checkbox" data-scene-field="default">作为作者默认场景</label><label class="stm-check-label"><input type="checkbox" data-scene-field="included">随角色卡导出此场景</label><div class="stm-inline-form"><label>场景封面<input type="file" accept="image/png,image/jpeg,image/webp,image/avif" data-scene-file="coverId"></label><button type="button" class="stm-secondary" data-scene-action="clear-cover">移除封面</button></div><div class="stm-inline-form"><label>场景背景<input type="file" accept="image/png,image/jpeg,image/webp,image/avif" data-scene-file="backgroundId"></label><button type="button" class="stm-secondary" data-scene-action="clear-background">移除背景</button></div><p class="stm-hint" data-scene-resources></p><h4>曲目与永久顺序</h4><div data-scene-selected></div><details><summary>从总曲库选择歌曲</summary><div data-scene-library></div></details><p class="stm-hint" data-scene-issues></p><button type="button" class="stm-secondary" data-scene-action="preview">试听／预览此场景</button></div><p class="stm-hint" data-scene-save-status aria-live="polite"></p><button type="button" class="stm-primary" data-scene-action="save">保存角色场景</button></div>';
    panel.append(root);let draft=null,avatar=null,selected=null,baseline='',epoch=0,dirty=false,saving=false,processing=0;const staged=new Map();
    const q=s=>root.querySelector(s),current=()=>draft?.scenes.find(s=>s.id===selected);
    for(const [id,theme] of Object.entries(DESIGN_THEMES))q('[data-scene-field=themeId]').append(new Option(theme.name,id));
    q('[data-scene-role]').id='stm-scene-role';q('[data-scene-field=themeId]').id='stm-scene-theme';const menus=createSelectMenus(panel,{controlsRoot:root});
    const noteSetting=doc.createElement('label');noteSetting.className='stm-check-label';noteSetting.innerHTML='<input type="checkbox" data-scene-show-notes>在手账中显示歌曲手记';q('[data-scene-selected]').before(noteSetting);
    function roles(){return (getContext().characters||[]).filter(c=>c.avatar&&c.avatar!=='none');}
    function load(target){
        avatar=target;const group=roleSceneGroup(settings,avatar);baseline=JSON.stringify(group);draft=normalizeSceneSet(group||{});dirty=false;staged.clear();
        if(!group){const legacy=playlistForCharacter(settings,avatar);if(legacy)draft=normalizeSceneSet({scenes:[{id:'scene:'+createTrackId(),name:legacy.name,trackIds:legacy.trackIds}]});}
        selected=draft.scenes[0]?.id||null;render();
    }
    function render(){
        q('[data-scene-role]').value=avatar||'';q('[data-scene-fields]').hidden=!current();
        const list=q('.stm-scene-editor-list');list.replaceChildren();
        for(const s of draft?.scenes||[]){const row=doc.createElement('div');row.className='stm-scene-editor-row';const pick=button(doc,s.name+(s.id===draft.defaultSceneId?' · 默认':''),'select',s.id);pick.setAttribute('aria-pressed',String(s.id===selected));row.append(pick,button(doc,'↑','scene-up',s.id),button(doc,'↓','scene-down',s.id));list.append(row);}
        const s=current();if(!s){menus.refresh();return;}
        for(const key of ['name','description','themeId'])q(`[data-scene-field=${key}]`).value=s[key];
        q('[data-scene-field=default]').checked=draft.defaultSceneId===s.id;q('[data-scene-field=included]').checked=s.included;
        q('[data-scene-show-notes]').checked=draft.showNotes;
        q('[data-scene-counter]').value=textLength(s.description)+' / 300';
        q('[data-scene-resources]').textContent=`封面：${s.coverId?'已选择':'沿用歌曲'} · 背景：${s.backgroundId?'已选择':'沿用播放器'}`;
        renderTracks();menus.refresh();
    }
    function renderTracks(){
        const s=current();if(!s)return;const tracks=allTracks(settings),byId=new Map(tracks.map(t=>[t.id,t])),chosen=q('[data-scene-selected]');chosen.replaceChildren();
        for(const id of s.trackIds){const row=doc.createElement('div');row.className='stm-scene-editor-row';const title=doc.createElement('span');title.textContent=byId.get(id)?.title||'缺少歌曲：'+id;row.append(title,button(doc,'↑','track-up',id),button(doc,'↓','track-down',id),button(doc,'移除','track-remove',id));chosen.append(row);
            const wrap=doc.createElement('details'),summary=doc.createElement('summary'),field=doc.createElement('textarea'),count=doc.createElement('output');
            wrap.dataset.sceneNoteWrap=id;summary.textContent='歌曲手记 · '+(byId.get(id)?.title||id);field.dataset.sceneNote=id;field.rows=3;field.maxLength=1000;field.setAttribute('aria-label','歌曲手记：'+(byId.get(id)?.title||id));field.value=draft.notes.find(n=>n.trackId===id)?.text||'';count.textContent=textLength(field.value)+' / 500';wrap.append(summary,field,count);chosen.append(wrap);
        }
        const library=q('[data-scene-library]');library.replaceChildren();
        for(const track of tracks){const label=doc.createElement('label');label.className='stm-check-label';const box=doc.createElement('input');box.type='checkbox';box.dataset.sceneTrack=track.id;box.checked=s.trackIds.includes(track.id);box.disabled=track.kind==='platform'&&!['full','preview'].includes(track.playback);label.append(box,doc.createTextNode(track.title+(box.disabled?' · 仅来源记录':'')));library.append(label);}
        q('[data-scene-issues]').textContent=sceneIssues(s,tracks).join('；');
    }
    function close(force=false){if(saving&&!force)return;epoch++;root.hidden=true;menus.close();staged.clear();void onPreview?.(null);draft=null;dirty=false;}
    function open(target){epoch++;q('[data-scene-role]').replaceChildren(...roles().map(c=>new Option(c.name||c.avatar,c.avatar)));const list=roles();if(!list.length){onError(new Error('请先创建或导入一个单人角色。'));return;}root.hidden=false;load(target&&list.some(c=>c.avatar===target)?target:list[0].avatar);}
    root.addEventListener('input',e=>{if(e.target.dataset.sceneNote){const id=e.target.dataset.sceneNote,value=e.target.value;e.target.setCustomValidity(textLength(value)>500?'歌曲手记最多 500 字':'');draft.notes=draft.notes.filter(n=>n.trackId!==id);if(value.trim())draft.notes.push({trackId:id,text:value});e.target.nextElementSibling.textContent=textLength(value)+' / 500';dirty=true;return;}
        const s=current(),field=e.target.dataset.sceneField;if(!s||!field)return;
        if(['name','description'].includes(field)){s[field]=e.target.value;const max=field==='name'?80:300;e.target.setCustomValidity(textLength(s[field])>max?`最多 ${max} 字`:'');dirty=true;if(field==='description')q('[data-scene-counter]').value=textLength(s.description)+' / 300';}
    },{signal:abort.signal});
    root.addEventListener('change',async e=>{
        try{
            if(e.target.matches('[data-scene-role]')){if(dirty&&!doc.defaultView.confirm('放弃尚未保存的场景修改？')){e.target.value=avatar;return;}epoch++;void onPreview?.(null);load(e.target.value);return;}
            const s=current();if(!s)return;const field=e.target.dataset.sceneField;
            if(e.target.matches('[data-scene-show-notes]'))draft.showNotes=e.target.checked;
            if(field==='themeId')s.themeId=e.target.value;if(field==='default'&&e.target.checked)draft.defaultSceneId=s.id;if(field==='included')s.included=e.target.checked;
            if(e.target.dataset.sceneTrack){const id=e.target.dataset.sceneTrack;if(e.target.checked&&!s.trackIds.includes(id))s.trackIds.push(id);else if(!e.target.checked)s.trackIds=s.trackIds.filter(x=>x!==id);renderTracks();}
            if(e.target.dataset.sceneFile){const key=e.target.dataset.sceneFile,file=e.target.files[0],token=epoch,sceneId=s.id;e.target.value='';if(!file)return;validateImageFile(file);let blob;processing++;try{blob=await prepareCover(file);}finally{processing--;}if(token!==epoch||root.hidden||current()?.id!==sceneId)return;const id=(key==='coverId'?'cover:':'background:')+createTrackId();staged.set(id,blob);if(key==='backgroundId')staged.set(id+':original',file);s[key]=id;render();}
            dirty=true;
        }catch(error){onError(error);}
    },{signal:abort.signal});
    root.addEventListener('click',async e=>{
        const b=e.target.closest('[data-scene-action]');if(!b||saving)return;const action=b.dataset.sceneAction,s=current();
        try{
            if(action==='close'){if(!dirty||doc.defaultView.confirm('放弃尚未保存的场景修改？'))close();return;}
            if(action==='new'||action==='copy'){
                if(draft.scenes.length>=MAX_SCENES)throw new Error('每个角色最多 12 个场景。');
                const row={...(action==='copy'&&s?structuredClone(s):{name:'新场景',description:'',trackIds:[],themeId:'inherit',included:true,coverId:null,backgroundId:null}),id:'scene:'+createTrackId()};
                if(action==='copy')row.name=Array.from(row.name).slice(0,76).join('')+' · 副本';draft.scenes.push(row);draft.defaultSceneId||=row.id;selected=row.id;
            }else if(action==='select'){selected=b.dataset.id;render();return;}
            else if(action==='delete'&&s){draft.scenes=draft.scenes.filter(x=>x.id!==s.id);if(draft.defaultSceneId===s.id)draft.defaultSceneId=draft.scenes[0]?.id||null;selected=draft.scenes[0]?.id||null;}
            else if(action==='clear-cover'&&s)s.coverId=null;
            else if(action==='clear-background'&&s)s.backgroundId=null;
            else if(action.startsWith('scene-')||action.startsWith('track-')){
                const sceneMove=action.startsWith('scene-'),ids=sceneMove?draft.scenes:s.trackIds,id=b.dataset.id,from=ids.findIndex(x=>sceneMove?x.id===id:x===id),to=from+(action.endsWith('up')?-1:1);
                if(action==='track-remove')s.trackIds=ids.filter(x=>x!==id);else if(from>=0&&to>=0&&to<ids.length)[ids[from],ids[to]]=[ids[to],ids[from]];
            }else if(action==='preview'&&s){if(processing)throw new Error('图片仍在处理，请稍后预览。');const issues=sceneIssues(s,allTracks(settings));if(issues.length)throw new Error(issues.join('；'));await onPreview?.({avatar,group:normalizeSceneSet(draft),sceneId:s.id,staged});return;}
            else if(action==='save'){
                if(processing)throw new Error('图片仍在处理，请稍后保存。');
                for(const field of root.querySelectorAll('input,textarea'))if(!field.reportValidity())return;
                if(JSON.stringify(roleSceneGroup(settings,avatar))!==baseline)throw new Error('此角色场景已在其他操作中改变，请关闭并重新打开，未覆盖原配置。');
                const candidate=saveRoleScenes({roleScenes:structuredClone(settings.roleScenes)},avatar,draft),refs=sceneAssetReferences([candidate]),writes=[...staged].filter(([id])=>refs.has(id));
                saving=true;root.inert=true;const token=epoch;root.setAttribute('aria-busy','true');await store.putMany(writes,{ifAbsent:true});
                if(token!==epoch||JSON.stringify(roleSceneGroup(settings,avatar))!==baseline)throw new Error('保存期间角色配置已改变，原场景未覆盖。');
                saveRoleScenes(settings,avatar,candidate);save();baseline=JSON.stringify(roleSceneGroup(settings,avatar));staged.clear();dirty=false;
                await onSaved?.(avatar);q('[data-scene-save-status]').textContent='场景已交给酒馆保存；未完成的场景仍作为草稿保留。';return;
            }
            dirty=true;render();
        }catch(error){onError(error);}finally{saving=false;root.inert=false;root.removeAttribute('aria-busy');}
    },{signal:abort.signal});
    return {open,close,get isOpen(){return !root.hidden;},dispose(){epoch++;abort.abort();menus.dispose();staged.clear();root.remove();}};
}
