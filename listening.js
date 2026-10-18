/** Layout-independent listening preferences. IDs always refer to a recording, never a row. */
export const TRANSITION_DURATIONS = [0, 150, 300, 500, 800];
export function normalizeFavorites(rows, ids, now = Date.now()) {
    const seen = new Set();
    return (Array.isArray(rows) ? rows : []).filter(row => row && ids.has(row.trackId)
        && Number.isFinite(row.at) && row.at > 0 && row.at <= now)
        .sort((a, b) => b.at - a.at).filter(row => !seen.has(row.trackId) && seen.add(row.trackId))
        .map(({ trackId, at }) => ({ trackId, at }));
}
export function toggleFavorite(settings, trackId, now = Date.now()) {
    if (settings.favorites.some(row => row.trackId === trackId)) {
        settings.favorites = settings.favorites.filter(row => row.trackId !== trackId); return false;
    }
    settings.favorites.unshift({ trackId, at: now }); return true;
}

/** Session-only deadline timer. A throttled/background callback checks the wall clock. */
export function createSleepTimer({ now = Date.now, schedule = setTimeout, unschedule = clearTimeout, onChange = () => {}, onExpire = () => {} } = {}) {
    let deadline = null, remaining = 0, mode = 'off', paused = false, handle, disposed = false;
    const snapshot = () => ({ mode, paused, remaining: mode === 'time' ? Math.max(0, paused ? remaining : deadline - now()) : 0 });
    function clear() { unschedule(handle); handle = undefined; }
    function notify() { onChange(snapshot()); }
    function finish() {
        if (disposed || mode === 'off') return false;
        clear(); mode = 'off'; deadline = null; remaining = 0; paused = false;
        notify(); onExpire(); return true;
    }
    function tick() {
        clear(); if (disposed || mode !== 'time' || paused) return;
        if (deadline <= now()) { finish(); return; }
        notify(); handle = schedule(tick, Math.min(1000, deadline - now()));
    }
    return {
        snapshot,
        start(minutes) {
            if (disposed || !Number.isFinite(minutes) || minutes < 1 || minutes > 1440) throw new Error('请输入 1 至 1440 分钟。');
            clear(); mode = 'time'; remaining = minutes * 60000; deadline = now() + remaining; paused = false; tick();
        },
        afterTrack() { if (disposed) return; clear(); mode = 'track'; paused = false; deadline = null; notify(); },
        pause() { if (mode !== 'time' || paused || disposed) return; remaining = Math.max(0, deadline - now()); paused = true; clear(); notify(); },
        resume() { if (mode !== 'time' || !paused || disposed) return; deadline = now() + remaining; paused = false; tick(); },
        cancel() { clear(); mode = 'off'; paused = false; remaining = 0; deadline = null; if (!disposed) notify(); },
        // Called before the queue's ended handler. Returning true suppresses auto-advance.
        ended() { return (mode === 'track' || mode === 'time' && !paused && deadline <= now()) && finish(); },
        check: tick,
        dispose() { disposed = true; clear(); mode = 'off'; deadline = null; remaining = 0; },
    };
}

/** One existing Audio element, one cancellable ramp; base volume is never persisted from gain. */
export function createAudioTransitions(audio, { getVolume, getDuration, now = () => performance.now(), schedule = setTimeout, unschedule = clearTimeout } = {}) {
    let sequence = 0, timer, settle, gain = 1, disposed = false, intent = audio.paused ? 'paused' : 'playing';
    const apply = () => { audio.volume = Math.max(0, Math.min(1, getVolume())) * gain; };
    function cancel(restore = true) {
        sequence++; unschedule(timer); timer = undefined;
        if (settle) { const done = settle; settle = null; done(false); }
        if (restore) { gain = 1; apply(); }
    }
    function ramp(target, duration, token) {
        if (disposed || sequence !== token) return Promise.resolve(false);
        if (!duration || audio.muted || !getVolume()) { gain = target; apply(); return Promise.resolve(true); }
        const started = now(), from = gain;
        return new Promise(resolve => {
            settle = resolve;
            const step = () => {
                if (disposed || token !== sequence) return;
                const progress = Math.min(1, Math.max(0, (now() - started) / duration));
                gain = from + (target - from) * progress; apply();
                if (progress >= 1) { settle = null; timer = undefined; resolve(true); }
                else timer = schedule(step, Math.min(16, duration - (now() - started)));
            }; step();
        });
    }
    return {
        get intent() { return intent; },
        async play() {
            if (disposed) return false;
            cancel(false); const token = sequence; intent = 'playing';
            gain = audio.paused && getDuration() ? 0 : gain; apply();
            try {
                // No await before play(): retain the original user activation.
                await audio.play();
                if (disposed || token !== sequence) return false;
                return await ramp(1, getDuration(), token);
            } catch (error) { if (token !== sequence || disposed) return false; intent = 'paused'; gain = 1; apply(); throw error; }
        },
        async pause() {
            if (disposed) return false;
            cancel(false); const token = sequence; intent = 'paused';
            if (!audio.paused && !await ramp(0, getDuration(), token)) return false;
            if (disposed || token !== sequence) return false;
            audio.pause(); gain = 1; apply(); return true;
        },
        fadeOut() { cancel(false); intent = 'paused'; return ramp(0, audio.paused ? 0 : getDuration(), sequence); },
        stop() { cancel(); intent = 'paused'; audio.pause(); },
        refresh() { cancel(); intent = audio.paused ? 'paused' : 'playing'; },
        dispose() { cancel(); disposed = true; intent = 'paused'; audio.pause(); },
    };
}
