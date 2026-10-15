window.addEventListener('DOMContentLoaded', () => {
    const panel = document.querySelector('#stm-player'), query = selector => panel.querySelector(selector);
    const settings = () => window.__previewContext.extensionSettings.riserein_music_player;
    const icon = path => `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${path}"/></svg>`;
    const icons = { playback:'M9 6v12l10-6zM4 6v12',library:'M4 4h5v16H4zM12 4h4v16h-4zM19 4l3 15',import:'M12 16V3m-5 5 5-5 5 5M4 15v6h16v-6',recent:'M12 4a8 8 0 1 1-7 4M3 3v6h6m3-2v5l3 2',ranking:'M5 20V10m7 10V4m7 16v-7',appearance:'M12 3a9 9 0 1 0 0 18V3Z' };
    for (const button of panel.querySelectorAll('[data-page]')) {
        const title = button.textContent; button.setAttribute('aria-label', title);
        button.innerHTML = `${icon(icons[button.dataset.page])}<span>${({recent:'最近',ranking:'排行'})[button.dataset.page] || title}</span>`;
    }
    const caption = document.createElement('span'); caption.className = 'ux-drag-caption ux-only'; caption.textContent = '按住此处移动';
    query('.stm-header-actions').before(caption);
    const controls = document.createElement('div'); controls.className = 'ux-player-controls';
    const cover = query('.stm-cover-stage'); cover.after(controls);
    const eyebrow = document.createElement('div'); eyebrow.className = 'ux-eyebrow ux-only'; eyebrow.textContent = '让旋律陪着故事继续'; controls.append(eyebrow);
    for (const selector of ['.stm-now','label[for=stm-seek]','#stm-seek','.stm-time','.stm-transport','.stm-options','.stm-volume']) controls.append(query(selector));
    const state = document.createElement('span'); state.className = 'ux-playback-state ux-only'; state.textContent = '准备好，随时播放'; query('.stm-now-info').append(state);
    const audio = query('audio');
    const launcher = document.querySelector('#stm-launcher'), disc = document.createElement('span'); disc.className='ux-launch-disc';disc.setAttribute('aria-hidden','true');disc.innerHTML='<img alt="">';launcher.append(disc);
    const coverObserver = new MutationObserver(()=>{disc.querySelector('img').src=query('.stm-cover-image').src;});
    coverObserver.observe(query('.stm-cover-image'),{attributes:true,attributeFilter:['src']});disc.querySelector('img').src=query('.stm-cover-image').src;
    const imageAnimations=new WeakMap();
    for(const image of [query('.stm-cover-image'),query('.stm-mini-disc img'),disc.querySelector('img')]) image.addEventListener('load',()=>{
        if(matchMedia('(prefers-reduced-motion:reduce)').matches || !image.animate)return;
        imageAnimations.get(image)?.cancel();imageAnimations.set(image,image.animate([{opacity:.6},{opacity:1}],{duration:180,easing:'ease-out'}));
    });
    for (const name of ['playing','pause','loadstart','waiting','error','loadedmetadata']) audio.addEventListener(name, () => {
        state.textContent = audio.error ? '播放失败 · 请查看原因' : name === 'playing' ? '正在播放 · 原型合成音' : ['waiting','loadstart'].includes(name) ? '正在准备音乐' : audio.paused ? '已暂停 · 手动开始播放' : '正在播放 · 原型合成音';
    });
    const tools = document.createElement('div'); tools.className = 'ux-library-tools ux-only';
    tools.innerHTML = '<label class="stm-sr-only" for="ux-library-search">搜索当前曲库</label><input id="ux-library-search" type="search" placeholder="搜索歌名或歌手"><select aria-label="曲库显示顺序"><option value="original">原有顺序</option><option value="name">歌名排序</option></select><label class="ux-filter-line"><input type="checkbox">只看可直接播放的歌曲</label>';
    query('.stm-track-list').before(tools);
    const noResults = document.createElement('p'); noResults.className = 'ux-search-empty ux-only'; noResults.hidden = true; noResults.textContent = '没有匹配的歌曲，试试其他关键词。'; tools.after(noResults);
    const hero = document.createElement('div'); hero.className = 'ux-collection-hero ux-only';
    hero.innerHTML = '<img alt="歌单封面"><div><strong></strong><small></small><p></p></div>'; query('[data-action=library-home]').after(hero);
    const managerButton=query('[data-action=toggle-manager]'),originalManagerParent=managerButton.parentElement;
    const rowOrder = new WeakMap(); let rowCount = 0;
    function filter() {
        const term = tools.querySelector('input[type=search]').value.trim().toLowerCase(), direct = tools.querySelector('input[type=checkbox]').checked;
        let visible = 0;
        for (const row of query('.stm-track-list').children) { row.hidden = !row.querySelector('.stm-track-select').textContent.toLowerCase().includes(term) || (direct && !row.querySelector('.stm-row-play')); if (!row.hidden) visible++; }
        noResults.hidden = Boolean(visible) || !query('.stm-track-list').children.length;
        const rows = [...query('.stm-track-list').children];
        rows.sort(tools.querySelector('select').value === 'name' ? (a,b) => a.querySelector('.stm-track-title').textContent.localeCompare(b.querySelector('.stm-track-title').textContent,'zh-CN') : (a,b) => rowOrder.get(a)-rowOrder.get(b));
        rows.forEach(row => query('.stm-track-list').append(row));
    }
    tools.addEventListener('input', filter); tools.addEventListener('change', filter);
    const detailsActions = document.createElement('div'); detailsActions.className = 'ux-detail-actions ux-only';
    detailsActions.innerHTML = '<button class="stm-primary" type="button" data-ux-detail="play">播放 / 暂停</button><button class="stm-secondary" type="button" data-ux-detail="membership">加入歌单</button><button class="stm-secondary stm-danger" type="button" data-ux-detail="remove">删除歌曲</button>';
    query('#stm-details .stm-details-summary').after(detailsActions);
    const currentRow = () => [...query('.stm-track-list').children].find(row => row.querySelector('.stm-track-title').textContent === query('[data-role=details-title]').textContent);
    detailsActions.addEventListener('click', event => {
        const type = event.target.dataset.uxDetail; if (!type) return;
        const row = currentRow(); if (!row) return;
        const action = type === 'play' ? row.querySelector('.stm-row-play') : type === 'remove' ? row.querySelector('.stm-remove') : row.querySelector('.stm-add-song') || [...row.querySelectorAll('button')].find(button => button.getAttribute('aria-label')?.startsWith('从歌单移除'));
        if (action) { if (type !== 'play') query('[data-action=close-details]').click(); action.click(); }
    });
    function decorate() {
        panel.dataset.libraryDetail = String(!query('#stm-library-detail').hidden);
        for (const row of query('.stm-track-list').children) {
            if (!rowOrder.has(row)) rowOrder.set(row,rowCount++);
            for (const button of row.querySelectorAll('.stm-remove,.stm-add-song,button[aria-label^="从歌单移除"]')) button.classList.add('ux-suppressed');
        }
        const selected = settings().playlists.find(p => p.id === settings().activePlaylistId);
        hero.querySelector('strong').textContent = selected?.name || '总曲库';
        hero.querySelector('small').textContent = `${query('.stm-track-list').children.length} 首 · ${selected?.characterAvatars.length ? '已绑定：书店里的旅人' : '未绑定角色'}`;
        hero.querySelector('p').textContent = selected?.id === 'preview-night' ? '雨声、灯火，还有那些缓缓展开的故事。' : selected ? '把喜欢的旋律，留给同一段旅程。' : '所有音乐在这里，找到今天想听的那一首。';
        const collection = [...panel.querySelectorAll('[data-collection-id]')].find(button => button.dataset.collectionId === (selected?.id || ''));
        hero.querySelector('img').src = collection?.querySelector('img')?.src || cover.querySelector('img').src;
        const row = currentRow(); detailsActions.querySelector('[data-ux-detail=play]').disabled = !row?.querySelector('.stm-row-play');
        detailsActions.querySelector('[data-ux-detail=membership]').textContent = row?.querySelector('.stm-add-song') ? '加入歌单' : '从此歌单移除';
        detailsActions.querySelector('[data-ux-detail=membership]').disabled = !row?.querySelector('.stm-add-song,button[aria-label^="从歌单移除"]');
        detailsActions.querySelector('[data-ux-detail=remove]').disabled = !row?.querySelector('.stm-remove');
    }
    let frame;
    const observer = new MutationObserver(() => { cancelAnimationFrame(frame); frame = requestAnimationFrame(() => {
        const newRows = [...query('.stm-track-list').children].some(row => !rowOrder.has(row));
        decorate(); if(newRows) filter();
    }); });
    observer.observe(query('.stm-track-list'),{childList:true}); observer.observe(query('[data-role=details-title]'),{childList:true,characterData:true,subtree:true});
    observer.observe(query('#stm-library-detail'),{attributes:true,attributeFilter:['hidden']});
    decorate();
    const appearance = query('#stm-appearance');
    function group(title, selectors, open = false) {
        const box = document.createElement('details'); box.className = 'ux-settings-group ux-only'; box.open = open;
        const summary = document.createElement('summary'); summary.textContent = title; box.append(summary);
        for (const selector of selectors) { const node = query(selector); if (node) box.append(node); }
        appearance.append(box);
    }
    group('文字与字体',['.stm-font-section'],true);
    group('颜色与材质',['.stm-scheme-control','.stm-theme-grid','.stm-custom-colors','.stm-surface-row','.stm-mask-control']);
    group('背景图片',['.stm-background-card']);
    group('窗口与偏好',['.stm-effects-toggle','label:has(#stm-hide-builtin)','[data-action=reset-position]']);
    // Groups remain accessible in the comparison mode too; only styling/layout changes.
    for (const box of appearance.querySelectorAll('.ux-settings-group')) box.classList.remove('ux-only');
    const resize = new ResizeObserver(([entry]) => { panel.dataset.width = entry.contentRect.width >= 520 ? 'wide' : 'narrow'; panel.dataset.height = entry.contentRect.height < 490 ? 'short' : entry.contentRect.height < 660 ? 'compact' : 'normal'; }); resize.observe(panel);
    const fontObserver = new MutationObserver(() => { panel.dataset.fontDefault = String(query('#stm-font').dataset.fontChoice === 'inherit'); });
    fontObserver.observe(query('#stm-font'),{attributes:true,attributeFilter:['data-font-choice']}); panel.dataset.fontDefault = 'true';
    window.applyPreviewConcept = (value) => {
        document.body.dataset.concept = value; panel.classList.toggle('ux-concept',value !== 'current');
        launcher.classList.toggle('ux-launcher',value !== 'current');
        if(value === 'current') originalManagerParent.append(managerButton); else hero.querySelector('div').append(managerButton);
        for (const button of document.querySelectorAll('[data-concept]')) button.setAttribute('aria-pressed',String(button.dataset.concept === value));
        if (value === 'current') { query('[data-theme-choice=pearl]').click(); query('[data-scheme-choice=light]').click(); }
        else {
            query(`[data-scheme-choice=${value === 'a' ? 'light' : 'dark'}]`).click();
            const palette = value === 'a' ? {accent:'#97583f',background:'#f4f0e7',text:'#2f302a'} : {accent:'#b2c3b1',background:'#182220',text:'#e8eee6'};
            for (const [name,color] of Object.entries(palette)) { const input=query(`[data-color=${name}]`);input.value=color;input.dispatchEvent(new Event('input',{bubbles:true})); }
        }
    };
    for (const button of document.querySelectorAll('[data-concept]')) button.addEventListener('click',()=>window.applyPreviewConcept(button.dataset.concept));
    function fitPreview() {
        const top=document.querySelector('.preview-toolbar').getBoundingClientRect().bottom+12;
        const width=Math.min(settings().panelSize.width,innerWidth-24),height=Math.min(settings().panelSize.height,Math.max(420,innerHeight-top-14));
        const left=Math.max(12,(innerWidth-width)/2);settings().panelSize={width,height};settings().positions.panel={x:left/innerWidth,y:top/innerHeight};
        Object.assign(panel.style,{left:`${left}px`,top:`${top}px`,right:'auto',transform:'none',width:`${width}px`,height:`${height}px`});
    }
    document.querySelector('#preview-size').addEventListener('change',event=>{ const [width,height]=event.target.value.split(',').map(Number);settings().panelSize={width,height};window.dispatchEvent(new Event('resize'));fitPreview(); });
    window.addEventListener('resize',fitPreview);
    document.querySelector('#preview-role').addEventListener('change',async event=>{ window.__previewContext.characterId=event.target.value === '' ? undefined : Number(event.target.value);await window.__previewContext.eventSource.emit('chat'); });
    document.querySelector('#preview-reopen').addEventListener('click',()=>{if(panel.hidden)document.querySelector('#stm-launcher').click();});
    window.applyPreviewConcept(new URL(location.href).searchParams.get('direction') === 'b' ? 'b' : 'a');
    document.querySelector('#stm-launcher').click();
    fitPreview();
    window.__previewReady = true;
});
