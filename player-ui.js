/** Presentation only: no storage, playlist mutations, network calls or audio commands. */
export function createPlayerUI(panel, launcher, audio) {
    panel.classList.add('stm-night-ui'); launcher.classList.add('stm-vinyl-launcher');
    const query = selector => panel.querySelector(selector);
    const paths = { playback:'M9 6v12l10-6zM4 6v12', library:'M4 4h5v16H4zM12 4h4v16h-4zM19 4l3 15', import:'M12 16V3m-5 5 5-5 5 5M4 15v6h16v-6', recent:'M12 4a8 8 0 1 1-7 4M3 3v6h6m3-2v5l3 2', ranking:'M5 20V10m7 10V4m7 16v-7', appearance:'M12 3a9 9 0 1 0 0 18V3Z' };
    for (const button of panel.querySelectorAll('[data-page]')) {
        const name = button.textContent;
        button.setAttribute('aria-label', name);
        button.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${paths[button.dataset.page]}"/></svg><span>${({recent:'最近', ranking:'排行'})[button.dataset.page] || name}</span>`;
    }
    const caption = document.createElement('span'); caption.className = 'stm-drag-caption'; caption.textContent = '按住此处移动'; query('.stm-header-actions').before(caption);
    query('[data-action="appearance"]').innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3a9 9 0 1 0 0 18V3Z"/></svg>';
    query('.stm-collection-hero > div').append(query('[data-action="toggle-manager"]'));
    const controls = document.createElement('div'); controls.className = 'stm-player-controls'; query('.stm-cover-stage').after(controls);
    const eyebrow = document.createElement('div'); eyebrow.className = 'stm-eyebrow'; eyebrow.textContent = '让旋律陪着故事继续'; controls.append(eyebrow);
    for (const selector of ['.stm-now','label[for=stm-seek]','#stm-seek','.stm-time','.stm-transport','.stm-options','.stm-volume']) controls.append(query(selector));
    const state = document.createElement('span'); state.className = 'stm-playback-state'; state.setAttribute('role','status'); query('.stm-now-info').append(state);
    const disc = document.createElement('span'); disc.className = 'stm-launch-disc'; disc.setAttribute('aria-hidden','true'); disc.innerHTML = '<img alt="">'; launcher.append(disc);
    const cover = query('.stm-cover-image');
    const syncCover = () => { disc.querySelector('img').src = cover.src; };
    const coverObserver = new MutationObserver(syncCover); coverObserver.observe(cover, {attributes:true,attributeFilter:['src']});
    const animations = new WeakMap(), reduced = matchMedia('(prefers-reduced-motion:reduce)');
    const fade = event => {
        const image = event.currentTarget;
        if (reduced.matches || panel.dataset.motion === 'off' || document.hidden || !image.animate) return;
        animations.get(image)?.cancel(); animations.set(image, image.animate([{opacity:.6},{opacity:1}], {duration:180,easing:'ease-out'}));
    };
    const images = [cover,query('.stm-mini-disc img'),disc.querySelector('img')].filter(Boolean);
    images.forEach(image => image.addEventListener('load',fade));
    let actuallyPlaying = false, resolving = false;
    function updateState(event) {
        if (event?.type === 'playing') actuallyPlaying = true;
        // A stalled download can still have buffered audio playing; only waiting stops playback.
        else if (['pause','ended','waiting','loadstart','emptied','error'].includes(event?.type)) actuallyPlaying = false;
        if (audio.paused || audio.ended || audio.error) actuallyPlaying = false;
        panel.dataset.audioState = resolving ? 'loading' : audio.error ? 'error' : actuallyPlaying ? 'playing' : audio.paused ? 'paused' : 'loading';
        launcher.dataset.audioState = panel.dataset.audioState;
        state.textContent = resolving ? '正在准备音乐' : !audio.getAttribute('src') ? '挑一首歌，开始今天的旋律' : audio.error ? '播放失败 · 请查看提示' : actuallyPlaying ? '正在播放' : audio.paused ? '已暂停 · 点击播放继续' : '正在准备音乐';
    }
    const events = ['play','playing','pause','ended','waiting','stalled','loadstart','emptied','error'];
    events.forEach(name => audio.addEventListener(name,updateState)); updateState(); syncCover();
    const appearance = query('#stm-appearance');
    function group(title, selectors, open = false) {
        const box = document.createElement('details'); box.className = 'stm-settings-group'; box.open = open;
        const summary = document.createElement('summary'); summary.textContent = title; box.append(summary);
        for (const selector of selectors) { const node = query(selector); if (node) box.append(node); }
        appearance.append(box);
    }
    group('文字与字体',['.stm-font-section'],true);
    group('配色与材质',['.stm-scheme-control','.stm-theme-grid','.stm-custom-colors','.stm-surface-row','.stm-mask-control'],true);
    group('背景图片',['.stm-background-card'],true);
    group('窗口与偏好',['.stm-effects-toggle','label:has(#stm-hide-builtin)','[data-role=builtin-hint]','[data-action=reset-position]'],true);
    const layout = () => {
        const {width,height} = panel.getBoundingClientRect();
        panel.dataset.width = width >= 520 ? 'wide' : 'narrow';
        panel.dataset.height = height < 490 ? 'short' : height < 660 ? 'compact' : 'normal';
        query('.stm-tabs').setAttribute('aria-orientation',width >= 520 ? 'vertical' : 'horizontal');
    };
    const observer = new ResizeObserver(layout); observer.observe(panel); layout();
    return { layout, setResolving(value) { resolving = value; updateState(); }, dispose() {
        observer.disconnect(); coverObserver.disconnect(); images.forEach(image => image.removeEventListener('load',fade));
        events.forEach(name => audio.removeEventListener(name,updateState));
    }};
}
