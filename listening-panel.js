import { toggleFavorite, createSleepTimer } from './listening.js';
import { formatTime } from './core.js';
import { playSymbol } from './player-components.js';

/** Shared controls: no Audio construction, IDB access or author configuration. */
export function createListeningPanel({ panel, settings, audio, getTrack, save, showPage, setSheetOpen, canPlay, onPlay, onAdd, onStop, showStatus }) {
    const doc = panel.ownerDocument, query = selector => panel.querySelector(selector);
    let disposed = false;
    const page = doc.createElement('section');
    page.className = 'stm-page'; page.dataset.view = 'favorites'; page.hidden = true;
    page.setAttribute('role', 'region'); page.setAttribute('aria-label', '我喜欢的音乐');
    page.innerHTML = `<button type="button" class="stm-secondary" data-favorite-home>‹ 我的音乐</button>
        <div class="stm-page-heading"><h3>我喜欢的音乐</h3><span>按收藏时间，从最近开始</span></div>
        <label class="stm-sr-only" for="stm-favorite-search">搜索收藏歌曲</label><input type="search" id="stm-favorite-search" placeholder="搜索收藏的歌名或歌手">
        <div class="stm-favorite-bulk"><label><input type="checkbox" data-favorite-all> 全选搜索结果</label><label class="stm-sr-only" for="stm-favorite-target">收藏加入哪个歌单</label><select id="stm-favorite-target"></select><button type="button" class="stm-secondary" data-favorite-add>加入歌单</button></div>
        <ol class="stm-favorite-list stm-history-list"></ol><p class="stm-hint" data-favorite-empty>点歌曲旁的爱心，把喜欢的旋律留在这里。</p>`;
    panel.insertBefore(page, query('.stm-status'));
    const home = doc.createElement('button'); home.type = 'button'; home.className = 'stm-secondary stm-favorites-entry';
    home.addEventListener('click', () => { render(); showPage('favorites'); }); query('#stm-library-home').prepend(home);
    query('[data-favorite-home]').addEventListener('click', () => showPage('library'));
    function mark(button, id) {
        const active = settings.favorites.some(row => row.trackId === id), track = getTrack(id);
        button.dataset.favoriteId = id || ''; button.className = 'stm-favorite-button'; button.disabled = !track;
        button.setAttribute('aria-pressed', String(active)); button.setAttribute('aria-label', `${active ? '取消收藏' : '收藏歌曲'}：${track?.title || '暂无歌曲'}`);
        button.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1.1-1.1a5.5 5.5 0 0 0-7.8 7.8L12 21l8.8-8.6a5.5 5.5 0 0 0 0-7.8Z"/></svg>`;
    }
    function toggle(id) {
        if (!getTrack(id)) return;
        toggleFavorite(settings, id); save();
        for (const button of panel.querySelectorAll('[data-favorite-id]')) mark(button, button.dataset.favoriteId);
        const focused = doc.activeElement?.dataset.favoriteId; render();
        if (focused && !page.hidden) [...page.querySelectorAll('[data-favorite-id]')].find(button => button.dataset.favoriteId === focused)?.focus({ preventScroll: true });
    }
    function button(id) { const node = doc.createElement('button'); node.type = 'button'; mark(node, id); node.addEventListener('click', () => toggle(node.dataset.favoriteId)); return node; }
    const current = button(settings.currentId), detail = button(null);
    query('.stm-options').append(current);
    query('.stm-detail-primary-actions').append(detail);
    query('#stm-favorite-search').addEventListener('input', render);
    query('[data-favorite-all]').addEventListener('change', event => { for (const input of page.querySelectorAll('[data-favorite-selection]')) input.checked = event.target.checked; });
    query('[data-favorite-add]').addEventListener('click', () => {
        const ids = [...page.querySelectorAll('[data-favorite-selection]:checked')].map(input => input.dataset.favoriteSelection);
        if (!ids.length) { showStatus('请先勾选要加入歌单的收藏歌曲。', true); return; }
        try { onAdd(query('#stm-favorite-target').value, ids); } catch (error) { showStatus(error.message, true); }
    });
    function render() {
        if (disposed) return;
        const term = query('#stm-favorite-search').value.trim().toLocaleLowerCase();
        const rows = settings.favorites.map(row => ({ ...row, track: getTrack(row.trackId) })).filter(row => row.track && `${row.track.title} ${row.track.artist || ''}`.toLocaleLowerCase().includes(term)).sort((a,b) => b.at-a.at);
        home.textContent = `♡ 我喜欢的音乐 · ${settings.favorites.length}`;
        const target = query('#stm-favorite-target'), old = target.value;
        target.replaceChildren(...settings.playlists.map(list => new Option(list.name, list.id))); target.value = settings.playlists.some(list => list.id === old) ? old : settings.playlists[0]?.id || '';
        query('[data-favorite-add]').disabled = !settings.playlists.length;
        query('[data-favorite-all]').checked = false;
        const list = query('.stm-favorite-list'); list.replaceChildren();
        for (const { track, at } of rows) {
            const row = doc.createElement('li'); row.className = 'stm-history-track';
            const check = doc.createElement('input'); check.type = 'checkbox'; check.dataset.favoriteSelection = track.id; check.setAttribute('aria-label', `选择收藏：${track.title}`);
            const select = doc.createElement('button'); select.className = 'stm-track-select'; select.type = 'button';
            const title = doc.createElement('span'), sub = doc.createElement('small'); title.textContent = track.title; sub.textContent = `${track.artist || '音乐'} · ${new Date(at).toLocaleDateString('zh-CN')}`; select.append(title, sub);
            select.addEventListener('click', () => onPlay(track.id));
            const play = doc.createElement('button'); play.type = 'button'; play.className = 'stm-row-play'; play.dataset.trackToggle = track.id; play.dataset.trackTitle = track.title; play.addEventListener('click', () => onPlay(track.id));
            // A source bookmark never advertises a failing playback button.
            if (!canPlay(track)) { play.textContent = '⋯'; play.setAttribute('aria-label', `查看歌曲：${track.title}`); delete play.dataset.trackToggle; }
            row.append(check, select, button(track.id), play); list.append(row);
        }
        query('[data-favorite-empty]').hidden = Boolean(rows.length);
        query('[data-favorite-empty]').textContent = term ? '没有匹配的收藏歌曲。' : '点歌曲旁的爱心，把喜欢的旋律留在这里。';
        update();
    }
    function update() {
        mark(current, settings.currentId);
        for (const play of page.querySelectorAll('[data-track-toggle]')) {
            const active = play.dataset.trackToggle === settings.currentId && !audio.paused && !audio.ended;
            play.innerHTML = playSymbol(active); play.setAttribute('aria-label', `${active ? '暂停歌曲' : '播放歌曲'}：${play.dataset.trackTitle}`); play.setAttribute('aria-pressed', String(active));
        }
    }
    const clock = doc.createElement('button'); clock.type = 'button'; clock.className = 'stm-sleep-button'; clock.setAttribute('aria-label', '睡眠定时器'); clock.setAttribute('aria-expanded', 'false');
    clock.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="13" r="8"/><path d="M9 2h6m-3 6v5l3 2"/></svg><small></small>';
    query('.stm-options').append(clock);
    const sheet = doc.createElement('div'); sheet.id = 'stm-sleep'; sheet.className = 'stm-queue-overlay'; sheet.hidden = true;
    sheet.innerHTML = `<div class="stm-queue-scrim" data-sleep-close></div><section class="stm-queue-sheet stm-sleep-sheet" role="dialog" aria-modal="true" aria-label="睡眠定时器"><span class="stm-sheet-grip" aria-hidden="true"></span><header><strong>睡眠定时器</strong><button type="button" class="stm-icon" aria-label="关闭睡眠定时器" data-sleep-close>×</button></header><p data-sleep-state role="status"></p><div class="stm-sleep-presets">${[15,30,45,60,90].map(value => `<button type="button" class="stm-secondary" data-sleep-minutes="${value}">${value} 分钟</button>`).join('')}</div><form class="stm-sleep-custom"><label for="stm-sleep-minutes">自定义分钟</label><input id="stm-sleep-minutes" type="number" min="1" max="1440" value="20" required><button type="submit" class="stm-secondary">开始</button></form><button type="button" class="stm-secondary" data-sleep-track>当前歌曲结束后停止</button><div class="stm-sleep-actions"><button type="button" class="stm-secondary" data-sleep-pause>暂停倒计时</button><button type="button" class="stm-secondary" data-sleep-cancel>取消定时</button></div><p class="stm-hint">关闭面板仍会计时；刷新页面或离开此随卡播放器时取消。后台页面恢复时会按实际截止时间检查。</p></section>`;
    panel.append(sheet);
    const timer = createSleepTimer({ onExpire: onStop, onChange(state) {
        const text = state.mode === 'off' ? '未设置定时' : state.mode === 'track' ? '当前歌曲结束后停止' : `${state.paused ? '已暂停 · ' : '剩余 '}${formatTime(Math.ceil(state.remaining / 1000))}`;
        query('[data-sleep-state]').textContent = text; clock.title = text; clock.querySelector('small').textContent = state.mode === 'off' ? '' : state.mode === 'track' ? '本曲' : formatTime(Math.ceil(state.remaining / 1000));
        clock.dataset.active = String(state.mode !== 'off'); query('[data-sleep-pause]').disabled = state.mode !== 'time'; query('[data-sleep-pause]').textContent = state.paused ? '继续倒计时' : '暂停倒计时'; query('[data-sleep-cancel]').disabled = state.mode === 'off';
    } });
    timer.cancel();
    clock.addEventListener('click', () => { setSheetOpen('#stm-sleep', true); clock.setAttribute('aria-expanded', 'true'); });
    function close() { setSheetOpen('#stm-sleep', false, true); clock.setAttribute('aria-expanded', 'false'); }
    for (const node of sheet.querySelectorAll('[data-sleep-close]')) node.addEventListener('click', close);
    sheet.addEventListener('keydown', event => {
        if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(); }
        if (event.key === 'Tab') { const nodes = [...sheet.querySelectorAll('button:not(:disabled),input')]; if (event.shiftKey && doc.activeElement === nodes[0]) { event.preventDefault(); nodes.at(-1).focus(); } else if (!event.shiftKey && doc.activeElement === nodes.at(-1)) { event.preventDefault(); nodes[0].focus(); } }
    });
    for (const node of sheet.querySelectorAll('[data-sleep-minutes]')) node.addEventListener('click', () => timer.start(Number(node.dataset.sleepMinutes)));
    query('.stm-sleep-custom').addEventListener('submit', event => { event.preventDefault(); try { timer.start(Number(query('#stm-sleep-minutes').value)); } catch (error) { showStatus(error.message, true); } });
    query('[data-sleep-track]').addEventListener('click', () => timer.afterTrack());
    query('[data-sleep-pause]').addEventListener('click', () => timer.snapshot().paused ? timer.resume() : timer.pause());
    query('[data-sleep-cancel]').addEventListener('click', () => timer.cancel());
    const check = () => timer.check(); doc.addEventListener('visibilitychange', check);
    const group = doc.createElement('details'); group.className = 'stm-settings-group'; group.open = true;
    group.innerHTML = '<summary>柔和播放过渡</summary><label for="stm-transition-duration">暂停、恢复与切歌</label><select id="stm-transition-duration"><option value="0">关闭</option><option value="150">150 ms</option><option value="300">300 ms</option><option value="500">500 ms</option><option value="800">800 ms</option></select><p class="stm-hint">只调整临时播放音量，不会改变你保存的音量；部分移动浏览器限制程序调整音量时，过渡可能不生效。</p>';
    query('#stm-appearance').append(group); query('#stm-transition-duration').value = String(settings.transitionDuration);
    render();
    return { button, timer, render, update, detail(id) { mark(detail, id); }, dispose() { disposed = true; timer.dispose(); doc.removeEventListener('visibilitychange', check); } };
}
