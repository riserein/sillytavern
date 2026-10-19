/** Input-driven follow state. No timers, global listeners or audio commands. */
export function createLyricReader({ view, scroller, lines, getDefaultFollow, getCurrent, getTitle, onBack }) {
    const abort = new AbortController(), title = view.querySelector('[data-lyric-title]'), status = view.querySelector('[data-lyric-status]'), resume = view.querySelector('[data-action=resume-lyrics]');
    let following = getDefaultFollow(), expected = null, pointer = null;
    const on = (node, type, fn, options = {}) => node.addEventListener(type, fn, { ...options, signal: abort.signal });
    function refresh() {
        title.textContent = getTitle() || '歌词';
        status.textContent = following ? '自动跟随' : '手动阅读';
        resume.hidden = following || getCurrent() < 0;
        view.dataset.follow = String(following);
    }
    function manual() { following = false; expected = null; refresh(); }
    function center() {
        const line = lines.children[getCurrent()];
        if (!following || view.hidden || !line) return;
        // Ignore CSS smooth scrolling for programmatic synchronization. Keyboard
        // input below is also owned here to avoid a native animation continuing.
        scroller.scrollTo({ top: scroller.scrollTop, behavior: 'instant' });
        const top = line.getBoundingClientRect().top - scroller.getBoundingClientRect().top - scroller.clientHeight / 2 + line.clientHeight / 2;
        scroller.scrollTo({ top: scroller.scrollTop + top, behavior: 'instant' });
        expected = scroller.scrollTop;
    }
    function reset() { following = getDefaultFollow(); expected = null; refresh(); }
    on(view.querySelector('[data-action=back-cover]'), 'click', onBack);
    on(resume, 'click', () => { following = true; refresh(); center(); scroller.focus({ preventScroll: true }); });
    on(scroller, 'wheel', manual, { passive: true });
    on(scroller, 'touchmove', manual, { passive: true });
    on(scroller, 'pointerdown', e => { pointer = { id: e.pointerId, y: e.clientY }; if (e.target === scroller) manual(); });
    on(scroller, 'pointermove', e => { if (pointer?.id === e.pointerId && Math.abs(e.clientY - pointer.y) > 6) manual(); }, { passive: true });
    for (const type of ['pointerup', 'pointercancel']) on(scroller, type, () => { pointer = null; });
    on(scroller, 'scroll', () => {
        if (expected !== null && Math.abs(scroller.scrollTop - expected) < 2) { expected = null; return; }
        if (!view.hidden) manual();
    }, { passive: true });
    on(view, 'keydown', e => {
        if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onBack(); }
        else if (e.target === scroller && ['ArrowDown', 'ArrowUp', 'PageDown', 'PageUp', 'Home', 'End', ' '].includes(e.key)) {
            manual(); e.preventDefault();
            const page = scroller.clientHeight * .9;
            const steps = { ArrowDown: 48, ArrowUp: -48, PageDown: page, PageUp: -page, ' ': e.shiftKey ? -page : page };
            const top = e.key === 'Home' ? 0 : e.key === 'End' ? scroller.scrollHeight : scroller.scrollTop + steps[e.key];
            // Own keyboard scrolling so a native PageDown animation cannot
            // outlive the user's explicit request to resume following.
            scroller.scrollTo({ top, behavior: 'instant' });
        }
    });
    refresh();
    return { reset, refresh, center, get following() { return following; }, dispose() { abort.abort(); pointer = null; expected = null; } };
}
