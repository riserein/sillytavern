import { flowPosition, normalizeLyricOffset } from './lyric-timing.js';
/** One bounded animation loop, one timeline and no audio mutations. */
export function createLyricReader({ view, scroller, lines, getDefaultFollow, getCurrent, getTitle, onBack, audio,
    getReading = () => ({}), getTimeline = () => ({ synced: false, lines: [] }), getTime = () => audio?.currentTime || 0,
    onTime = () => {}, getOffset = () => 0, onOffset = () => {}, isVisible = () => !view.hidden && !!view.getClientRects().length }) {
    const win = view.ownerDocument.defaultView, abort = new AbortController(), title = view.querySelector('[data-lyric-title]'), status = view.querySelector('[data-lyric-status]'), resume = view.querySelector('[data-action=resume-lyrics]');
    const immersive = view.ownerDocument.createElement('div'); immersive.className = 'stm-lyric-immersive'; immersive.hidden = true;
    immersive.innerHTML = '<p data-immersive-current></p><p data-immersive-next></p>'; view.append(immersive);
    const calibration = view.ownerDocument.createElement('details'); calibration.className = 'stm-lyric-calibration';
    calibration.innerHTML = '<summary>歌词时间校准 <output></output></summary><button type="button" class="stm-secondary" data-offset="-100">提前 0.1 秒</button><button type="button" class="stm-secondary" data-offset="100">延后 0.1 秒</button><button type="button" class="stm-secondary" data-offset="reset">重置校准</button><small>正值使歌词延后，不修改音频或原歌词时间戳。</small>';
    view.querySelector('header').append(calibration);
    let following = getDefaultFollow(), expected = null, pointer = null, frame = null, geometry = null, animation = null, lastIndex = -2, lastMode = '', disposed = false, lastText = '';
    const reduced = win.matchMedia('(prefers-reduced-motion: reduce)');
    const on = (node, type, fn, options = {}) => node?.addEventListener(type, fn, { ...options, signal: abort.signal });
    const visible = () => isVisible() && !view.ownerDocument.hidden;
    function stop() { if (frame !== null) win.cancelAnimationFrame(frame); frame = null; animation = null; immersive.querySelector('[data-immersive-current]').getAnimations?.().forEach(item => item.cancel()); }
    function measure() {
        if (geometry) return geometry;
        const bounds = scroller.getBoundingClientRect(), top = scroller.scrollTop;
        geometry = [...lines.children].map(line => { const rect = line.getBoundingClientRect(); return rect.top - bounds.top + top + rect.height / 2 - scroller.clientHeight / 2; });
        return geometry;
    }
    function place(top) { scroller.scrollTo({ top, behavior: 'instant' }); expected = scroller.scrollTop; }
    function refresh() {
        const reading = getReading(), mode = reading.displayMode || 'flow', data = getTimeline(), index = getCurrent();
        if (mode !== lastMode) { stop(); geometry = null; lastIndex = -2; lastMode = mode; }
        view.dataset.lyricMode = mode;
        const single = mode === 'immersive' && data.synced;
        scroller.hidden = single; immersive.hidden = !single;
        title.textContent = getTitle() || '歌词';
        status.textContent = !data.synced && mode === 'immersive' ? '无时间轴 · 阅读原文' : single ? '单句同步' : following ? '自动跟随' : '手动阅读';
        resume.hidden = single || following || index < 0;
        view.dataset.follow = String(following);
        const text = data.lines[index]?.text || (index < 0 ? '等待歌词开始' : '');
        if (single && text !== lastText) {
            const current = immersive.querySelector('[data-immersive-current]'); current.textContent = text; lastText = text;
            current.getAnimations?.().forEach(item => item.cancel());
            if (!reduced.matches) current.animate?.([{ opacity: .85, transform: 'translateY(6px)' }, { opacity: 1, transform: 'translateY(0)' }], { duration: 300, easing: 'ease-out' });
        }
        immersive.querySelector('[data-immersive-next]').textContent = single && reading.nextLine !== false ? data.lines[index + 1]?.text || '' : '';
        calibration.querySelector('output').textContent = (getOffset() / 1000).toFixed(1) + ' 秒';
        calibration.hidden = !data.synced;
        schedule();
    }
    function manual() { following = false; expected = null; stop(); refresh(); }
    function move(now, immediate = false) {
        const data = getTimeline(), index = getCurrent(), mode = getReading().displayMode || 'flow';
        if (!following || !visible() || !data.synced || mode === 'immersive') return;
        const centers = measure(), target = centers[Math.max(0, index)] || 0;
        if (immediate || reduced.matches) { animation = null; place(target); lastIndex = index; return; }
        if (mode === 'flow') { place(flowPosition(data.lines, centers, index, getTime())); lastIndex = index; }
        else {
            if (index !== lastIndex) { animation = { from: scroller.scrollTop, target, start: now }; lastIndex = index; }
            if (animation) { const progress = Math.min(1, Math.max(0, (now - animation.start) / 450)); place(animation.from + (animation.target - animation.from) * (1 - (1 - progress) ** 3)); if (progress >= 1) animation = null; }
        }
    }
    function tick(now) { frame = null; if (disposed || !visible()) return; onTime(); move(now); schedule(); }
    function schedule() {
        if (disposed || frame !== null || !visible() || !getTimeline().synced) return;
        const playing = audio && !audio.paused && !audio.ended;
        if ((playing && (following || getReading().displayMode === 'immersive')) || animation) frame = win.requestAnimationFrame(tick);
    }
    function center(immediate = false) { if (disposed) return; refresh(); move(win.performance.now(), immediate); schedule(); }
    function reset() { stop(); following = getDefaultFollow(); expected = null; geometry = null; lastIndex = -2; lastText = ''; refresh(); }
    function invalidate() { geometry = null; center(true); }
    on(view.querySelector('[data-action=back-cover]'), 'click', onBack);
    on(resume, 'click', () => { following = true; center(true); scroller.focus({ preventScroll: true }); });
    on(calibration, 'click', e => { const button = e.target.closest('[data-offset]'); if (!button) return; onOffset(button.dataset.offset === 'reset' ? 0 : normalizeLyricOffset(getOffset() + Number(button.dataset.offset))); onTime(); geometry = null; center(true); });
    on(scroller, 'wheel', manual, { passive: true }); on(scroller, 'touchmove', manual, { passive: true });
    on(scroller, 'pointerdown', e => { pointer = { id: e.pointerId, y: e.clientY }; if (e.target === scroller) manual(); });
    on(scroller, 'pointermove', e => { if (pointer?.id === e.pointerId && Math.abs(e.clientY - pointer.y) > 6) manual(); }, { passive: true });
    for (const type of ['pointerup', 'pointercancel']) on(scroller, type, () => { pointer = null; });
    on(scroller, 'scroll', () => { if (expected !== null && Math.abs(scroller.scrollTop - expected) < 2) return; if (visible()) manual(); }, { passive: true });
    on(view, 'keydown', e => {
        if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onBack(); }
        else if (e.target === scroller && ['ArrowDown', 'ArrowUp', 'PageDown', 'PageUp', 'Home', 'End', ' '].includes(e.key)) {
            manual(); e.preventDefault(); const page = scroller.clientHeight * .9, steps = { ArrowDown: 48, ArrowUp: -48, PageDown: page, PageUp: -page, ' ': e.shiftKey ? -page : page };
            scroller.scrollTo({ top: e.key === 'Home' ? 0 : e.key === 'End' ? scroller.scrollHeight : scroller.scrollTop + steps[e.key], behavior: 'instant' });
        }
    });
    for (const type of ['play', 'playing', 'pause', 'timeupdate', 'seeked']) on(audio, type, () => { onTime(); center(type === 'seeked'); });
    on(audio, 'seeking', () => { stop(); lastIndex = -2; onTime(); center(true); });
    on(view.ownerDocument, 'visibilitychange', () => { stop(); if (visible()) center(true); });
    const observer = new win.ResizeObserver(() => { if (visible()) invalidate(); else geometry = null; }); observer.observe(scroller); observer.observe(lines);
    refresh();
    return { reset, refresh, center, invalidate, suspend: stop, get following() { return following; }, get animationCount() { return frame === null ? 0 : 1; }, dispose() { disposed = true; stop(); abort.abort(); observer.disconnect(); immersive.remove(); calibration.remove(); pointer = null; geometry = null; } };
}
