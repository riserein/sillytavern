import { normalizeVisibility } from './visibility-state.js';
/** UI state only. Recovery controls are host-owned and survive HIDDEN, never dispose. */
export function createVisibilityController({ panel, launcher, audio, getPreference, setPreference, getTrackId, close, open, onHide, onStatus = () => {},
    hostDocument = panel.ownerDocument, recoveryId = 'full', helperRecovery, preview = false, externalRecovery = false, allowWand = true, positionElement = launcher, onPosition = () => {}, getInput = () => hostDocument.querySelector('#send_form') }) {
    const doc = hostDocument, win = doc.defaultView, abort = new win.AbortController();
    let preference = normalizeVisibility(getPreference()), disposed = false, entry = null, menu = null, monitor = null, helperOff = null, epoch = 0, stoppedByHide = preference.state === 'hidden', pendingResume = preference.resume;
    const normalLabel = launcher.getAttribute('aria-label') || '展开音乐播放器';
    const ownId = 'rscp-recovery-' + encodeURIComponent(recoveryId), add = (target, type, fn, options = {}) => target?.addEventListener(type, fn, { ...options, signal: abort.signal });
    const controls = panel.ownerDocument.createElement('div'); controls.className = 'stm-visibility-controls';
    controls.innerHTML = '<button type="button" class="stm-secondary" data-display-dock>贴边收起</button><button type="button" class="stm-secondary" data-display-hide>隐藏角色音乐</button><label>拖动后贴边<select id="stm-display-snap-mode" aria-label="拖动后贴边"><option value="off">不自动吸附</option><option value="snap">保留完整悬浮入口</option><option value="tab">半隐藏边缘标签</option></select></label><p data-visibility-notice role="status"></p>';
    (panel.querySelector('#stm-appearance') || panel.querySelector('[data-view=appearance]') || panel).append(controls);
    const menuControl = panel.ownerDocument.createElement('details'); menuControl.className = 'stm-visibility-menu';
    menuControl.innerHTML = '<summary aria-label="播放器显示菜单">⋯</summary><button type="button" class="stm-secondary" data-display-dock>贴边收起</button><button type="button" class="stm-secondary" data-display-hide>隐藏角色音乐</button>';
    (panel.querySelector('.stm-header') || panel.querySelector('.head') || panel).append(menuControl);
    function notify(text) { controls.querySelector('[data-visibility-notice]').textContent = text; onStatus(text); }
    function persist() { setPreference({ ...preference }); }
    function helperVisible() {
        if (!helperRecovery?.available?.()) return false;
        const container = doc.getElementById('script_container_' + helperRecovery.scriptId);
        return !!container && [...container.children].some(node => node.textContent.trim() === '显示/隐藏角色音乐' && node.getClientRects().length > 0);
    }
    function recoverable() {
        const button = doc.getElementById('extensionsMenuButton');
        return (typeof externalRecovery === 'function' ? externalRecovery() : externalRecovery) || (entry?.isConnected && (preview || (menu?.isConnected && button?.isConnected && win.getComputedStyle(button).display !== 'none'))) || helperVisible();
    }
    function label() {
        if (!entry) return;
        entry.textContent = '角色音乐播放器 · ' + ({ hidden: '已隐藏', docked: '已贴边', normal: '显示中' }[preference.state]);
        entry.setAttribute('aria-pressed', String(preference.state === 'hidden'));
        entry.setAttribute('aria-label', preference.state === 'hidden' ? '角色音乐播放器 · 已隐藏，点击恢复' : '角色音乐播放器 · 点击隐藏');
    }
    function recovery() {
        if (disposed) return;
        monitor?.disconnect();
        const target = preview ? doc.body : doc.getElementById('extensionsMenu');
        const supported = preview || allowWand && !(typeof externalRecovery === 'function' ? externalRecovery() : externalRecovery) && !!(target && doc.getElementById('extensionsMenuButton'));
        if (entry?.isConnected && (!supported || (!preview && entry.parentNode !== target))) entry.remove();
        if (supported && !entry?.isConnected) {
            entry = doc.createElement('button'); entry.type = 'button'; entry.id = ownId; entry.dataset.risereinRecovery = recoveryId;
            entry.className = preview ? 'rscp-preview-recovery' : 'list-group-item flex-container flexGap5 interactable';
            if (preview) { entry.style.cssText = 'position:fixed;left:12px;bottom:12px;z-index:2147483646;padding:10px 14px;border-radius:12px;background:#24362f;color:#fff;font:14px system-ui;max-width:calc(100vw - 24px)'; entry.title = '预览模拟恢复入口，不是酒馆魔棒'; }
            else entry.style.cssText = 'display:block;width:100%;min-height:40px;padding:8px 10px;border:0;border-radius:0;background:transparent;color:inherit;font:inherit;text-align:left;white-space:normal';
            add(entry, 'click', toggle); target.append(entry); menu = target;
        }
        monitor?.observe(doc.body,{childList:true});
        if (menu && menu !== doc.body) monitor?.observe(menu, { childList: true });
        // A visible Helper bar can be the sole recovery route. Track only its
        // bounded ancestor chain, not chat contents, and release replaced nodes.
        let helper = helperRecovery && doc.getElementById('script_container_'+helperRecovery.scriptId);
        for(let depth=0;helper && helper!==doc.body && depth<6;depth++,helper=helper.parentElement)monitor?.observe(helper,{childList:true,attributes:true,attributeFilter:['hidden','style','class']});
        const wand = doc.getElementById('extensionsMenuButton'); if(wand)monitor?.observe(wand,{attributes:true,attributeFilter:['class','style','hidden']});
        label();
        if (preference.state === 'hidden' && !recoverable()) { preference.state = 'docked'; render(); persist(); notify('当前环境缺少可靠的恢复入口，已改为贴边收起。'); }
    }
    function placeEdge() {
        if (disposed || preference.state !== 'docked') return;
        const visible = win.visualViewport, bounds = launcher.getBoundingClientRect(),css=win.getComputedStyle(launcher),inset=side=>Math.max(8,parseFloat(css.getPropertyValue('--stm-safe-'+side))||0), left = (visible?.offsetLeft || 0) + inset('left'), top = (visible?.offsetTop || 0) + inset('top');
        const width = visible?.width || win.innerWidth, height = visible?.height || win.innerHeight;
        let x = preference.edge === 'left' ? left : (visible?.offsetLeft || 0) + width - bounds.width - inset('right');
        let y = Math.max(top, Math.min(bounds.y, (visible?.offsetTop || 0) + height - bounds.height - inset('bottom')));
        const input = win.innerWidth <= 600 ? getInput()?.getBoundingClientRect() : null;
        if (input?.height && x < input.right && x + bounds.width > input.left && y < input.bottom && y + bounds.height > input.top) y = Math.max(top, input.top - bounds.height - 8);
        Object.assign(positionElement.style, { left: Math.max(left, x) + 'px', top: y + 'px', right: 'auto', transform: 'none' });
    }
    function render() {
        launcher.dataset.display = preference.state; launcher.dataset.dockEdge = preference.edge;
                launcher.setAttribute('aria-label', preference.state === 'docked' ? '恢复角色音乐播放器' : normalLabel);
        if (preference.state !== 'normal') close();
        launcher.hidden = preference.state === 'hidden';
        if (preference.state === 'docked') placeEdge();
        controls.querySelector('select').value = preference.snapMode; label();
    }
    function setState(state) {
        if (disposed) return;
        recovery();
        if (state === 'hidden' && !recoverable()) { state = 'docked'; notify('当前环境缺少可靠的恢复入口，只能贴边收起。'); }
        const previous = preference.state; preference.state = state;
        if (state === 'hidden') {
            epoch++; stoppedByHide = true; preference.resume = { id: getTrackId() || '', time: Number.isFinite(audio.currentTime) ? audio.currentTime : 0 };
            onHide(); audio.pause();
        } else if (previous === 'hidden') audio.pause();
        menuControl.open = false; render(); persist();
    }
    function toggle() { setState(preference.state === 'hidden' ? 'normal' : 'hidden'); }
    for (const root of [controls, menuControl]) {
        add(root.querySelector('[data-display-hide]'), 'click', () => setState('hidden'));
        add(root.querySelector('[data-display-dock]'), 'click', () => setState('docked'));
    }
    add(controls.querySelector('select'), 'change', e => { preference.snapMode = e.target.value; persist(); });
    add(launcher, 'click', e => { if (preference.state !== 'docked') return; e.preventDefault(); e.stopImmediatePropagation(); setState('normal'); open(); }, { capture: true });
    add(audio, 'play', () => { if (preference.state === 'hidden') { onHide(); audio.pause(); } else stoppedByHide = false; });
    add(audio, 'loadedmetadata', () => { if (pendingResume?.id !== getTrackId()) return; audio.currentTime = Math.min(pendingResume.time, Number.isFinite(audio.duration) ? Math.max(0, audio.duration - .01) : pendingResume.time); pendingResume = null; });
    for (const target of [win, win.visualViewport]) { add(target, 'resize', placeEdge); if (target === win.visualViewport) add(target, 'scroll', placeEdge); }
    if (helperRecovery?.subscribe) helperOff = helperRecovery.subscribe(toggle);
    // Watch only host menu/body child replacement, never message contents.
    monitor = new win.MutationObserver(recovery); monitor.observe(doc.body, { childList: true });
    recovery(); if (menu && menu !== doc.body) monitor.observe(menu, { childList: true });
    if (preference.state === 'hidden') { epoch++; onHide(); audio.pause(); }
    render();
    return {
        get autoAdvanceAllowed() { return !stoppedByHide; }, get state() { return preference.state; }, get epoch() { return epoch; }, get recoveryAvailable() { return !!recoverable(); }, setState,
        restore() { if (preference.state !== 'normal') setState('normal'); },
        refresh() { recovery(); if (preference.state === 'docked') placeEdge(); },
        dragStart() { if (preference.state === 'docked') setState('normal'); launcher.dataset.snapped = 'false'; },
        dragEnd(bounds, viewport) {
            if (preference.snapMode === 'off') return;
            const left = bounds.left ?? bounds.x, edge = left <= 40 ? 'left' : left + bounds.width >= viewport.width - 40 ? 'right' : null;
            if (!edge) return; preference.edge = edge;
            if (preference.snapMode === 'tab') setState('docked');
            else { launcher.dataset.snapped = 'true'; const x = edge === 'left' ? 8 : viewport.width - bounds.width - 8; positionElement.style.left = x + 'px'; onPosition({x:x/Math.max(1,viewport.width),y:(bounds.top ?? bounds.y)/Math.max(1,viewport.height)}); persist(); }
        },
        dispose() { if (disposed) return; disposed = true; abort.abort(); monitor.disconnect(); try {helperOff?.();} catch {} entry?.remove(); controls.remove(); menuControl.remove(); }
    };
}
