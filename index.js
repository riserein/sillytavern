import { MAX_TRACKS, createTrackId, normalizeSettings, normalizeUrl, titleFromUrl, nextTrackId, formatTime, validateAudioFile } from './core.js';
import { LocalMusicStore } from './local-store.js';

const SETTINGS_KEY = 'riserein_music_player';

function initialize() {
    if (document.getElementById('stm-player')) return;
    const context = globalThis.SillyTavern?.getContext();
    if (!context?.extensionSettings || !context.saveSettingsDebounced) {
        console.error('[酒馆音乐播放器] 无法获取酒馆扩展接口，请更新 SillyTavern。');
        return;
    }

    const settings = normalizeSettings(context.extensionSettings[SETTINGS_KEY]);
    const store = new LocalMusicStore();
    let objectUrl = null;
    let loadSequence = 0;
    let importing = false;

    const launcher = document.createElement('button');
    launcher.id = 'stm-launcher';
    launcher.type = 'button';
    launcher.className = 'stm-launcher';
    launcher.textContent = '♫';
    launcher.title = '打开音乐播放器';
    launcher.setAttribute('aria-label', '打开音乐播放器');
    launcher.setAttribute('aria-controls', 'stm-player');
    launcher.setAttribute('aria-expanded', 'false');

    const panel = document.createElement('section');
    panel.id = 'stm-player';
    panel.className = 'stm-player';
    panel.hidden = true;
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-labelledby', 'stm-heading');
    panel.innerHTML = `
        <header class="stm-header">
            <div><span class="stm-eyebrow">TAVERN MUSIC</span><h2 id="stm-heading">酒馆音乐播放器</h2></div>
            <button type="button" class="stm-icon" data-action="close" aria-label="关闭播放器" title="关闭面板，音乐继续播放">×</button>
        </header>
        <div class="stm-now">
            <span class="stm-art" aria-hidden="true">♫</span>
            <div class="stm-now-info"><strong data-role="title">还没有音乐</strong><span data-role="source">导入喜欢的音乐，为故事配上背景</span></div>
        </div>
        <audio preload="metadata"></audio>
        <label class="stm-sr-only" for="stm-seek">播放进度</label>
        <input id="stm-seek" class="stm-range" type="range" min="0" max="0" step="0.1" value="0" disabled>
        <div class="stm-time"><span data-role="elapsed">0:00</span><span data-role="duration">0:00</span></div>
        <div class="stm-transport">
            <button type="button" class="stm-icon" data-action="previous" aria-label="上一首" title="上一首">❮</button>
            <button type="button" class="stm-primary stm-play" data-action="play">▶ 播放</button>
            <button type="button" class="stm-icon" data-action="next" aria-label="下一首" title="下一首">❯</button>
        </div>
        <div class="stm-options">
            <label for="stm-mode">播放模式</label>
            <select id="stm-mode"><option value="sequence">顺序播放</option><option value="list">列表循环</option><option value="single">单曲循环</option><option value="shuffle">随机播放</option></select>
        </div>
        <div class="stm-volume">
            <button type="button" class="stm-icon" data-action="mute" aria-label="静音" title="静音">♪</button>
            <label class="stm-sr-only" for="stm-volume">音量</label>
            <input id="stm-volume" class="stm-range" type="range" min="0" max="100" step="1">
            <output for="stm-volume" data-role="volume"></output>
        </div>
        <div class="stm-divider"></div>
        <div class="stm-list-heading"><h3>播放列表 <span data-role="count">0</span></h3>
            <button type="button" class="stm-secondary" data-action="import">＋ 本地音乐</button>
            <input type="file" data-role="files" accept="audio/*,.mp3,.wav,.ogg,.oga,.m4a,.aac,.flac,.opus,.webm" multiple hidden>
        </div>
        <form class="stm-url-form">
            <label class="stm-sr-only" for="stm-url">音乐直链</label>
            <input id="stm-url" type="url" placeholder="粘贴音乐直链（HTTP / HTTPS）" required autocomplete="off">
            <button type="submit" class="stm-secondary">添加</button>
        </form>
        <p class="stm-hint">支持音频直链，不支持网易云、QQ 音乐等歌曲分享页。</p>
        <ol class="stm-track-list" aria-label="播放列表"></ol>
        <p class="stm-empty">列表还是空的，导入本地音乐或添加直链开始吧。</p>
        <p class="stm-status" role="status" aria-live="polite"></p>
        <footer class="stm-footer">本地文件保存在当前浏览器 · 关闭面板可继续播放</footer>`;
    document.body.append(launcher, panel);

    const query = selector => panel.querySelector(selector);
    const audio = query('audio');
    const status = query('.stm-status');
    const playButton = query('[data-action="play"]');
    const fileInput = query('[data-role="files"]');
    const seek = query('#stm-seek');
    const volume = query('#stm-volume');
    const mode = query('#stm-mode');
    const list = query('.stm-track-list');
    const urlInput = query('#stm-url');

    function save() {
        context.extensionSettings[SETTINGS_KEY] = settings;
        context.saveSettingsDebounced();
    }

    function showStatus(message = '', error = false) {
        status.textContent = message;
        status.classList.toggle('stm-error', error);
    }

    function setOpen(open) {
        panel.hidden = !open;
        launcher.setAttribute('aria-expanded', String(open));
        if (open) query('[data-action="close"]').focus();
        else if (panel.contains(document.activeElement)) launcher.focus();
    }

    function renderTracks() {
        list.replaceChildren();
        for (const track of settings.tracks) {
            const row = document.createElement('li');
            row.className = 'stm-track';
            row.classList.toggle('stm-active', track.id === settings.currentId);
            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'stm-track-select';
            button.setAttribute('aria-label', `播放：${track.title}`);
            button.setAttribute('aria-current', track.id === settings.currentId ? 'true' : 'false');
            const title = document.createElement('span');
            title.className = 'stm-track-title';
            title.textContent = track.title;
            const source = document.createElement('small');
            source.textContent = track.kind === 'local' ? '本地音乐' : new URL(track.url).hostname;
            button.append(title, source);
            button.addEventListener('click', () => void selectTrack(track.id, true));
            const remove = document.createElement('button');
            remove.type = 'button';
            remove.className = 'stm-icon stm-remove';
            remove.textContent = '×';
            remove.setAttribute('aria-label', `删除：${track.title}`);
            remove.title = '从列表删除此音乐';
            remove.addEventListener('click', () => void removeTrack(track.id));
            row.append(button, remove);
            list.append(row);
        }
        query('[data-role="count"]').textContent = String(settings.tracks.length);
        query('.stm-empty').hidden = settings.tracks.length > 0;
        playButton.disabled = settings.tracks.length === 0;
        query('[data-action="previous"]').disabled = settings.tracks.length === 0;
        query('[data-action="next"]').disabled = settings.tracks.length === 0;
    }

    function updateProgress() {
        const duration = Number.isFinite(audio.duration) ? audio.duration : 0;
        seek.disabled = duration <= 0;
        seek.max = String(duration);
        seek.value = String(audio.currentTime || 0);
        query('[data-role="elapsed"]').textContent = formatTime(audio.currentTime);
        query('[data-role="duration"]').textContent = formatTime(duration);
    }

    function updatePlayback() {
        const playing = !audio.paused && !audio.ended;
        playButton.textContent = playing ? 'Ⅱ 暂停' : '▶ 播放';
        launcher.classList.toggle('stm-playing', playing);
        launcher.title = playing ? '正在播放音乐 · 打开播放器' : '打开音乐播放器';
        launcher.setAttribute('aria-label', launcher.title);
    }

    function releaseSource() {
        audio.pause();
        audio.removeAttribute('src');
        audio.load();
        if (objectUrl) URL.revokeObjectURL(objectUrl);
        objectUrl = null;
        updateProgress();
    }

    async function play() {
        try {
            await audio.play();
            showStatus();
        } catch (error) {
            if (error.name === 'AbortError') return;
            showStatus(error.name === 'NotAllowedError'
                ? '浏览器阻止了自动播放，请再点一次“播放”。'
                : '无法播放此音乐，请检查格式或直链是否可访问。', true);
        }
    }

    async function selectTrack(id, shouldPlay = false) {
        const sequence = ++loadSequence;
        releaseSource();
        const track = settings.tracks.find(item => item.id === id);
        settings.currentId = track?.id ?? null;
        save();
        renderTracks();
        query('[data-role="title"]').textContent = track?.title ?? '还没有音乐';
        query('[data-role="source"]').textContent = track ? (track.kind === 'local' ? '本地音乐' : '在线音乐') : '导入喜欢的音乐，为故事配上背景';
        showStatus();
        if (!track) return;
        try {
            let source = track.url;
            if (track.kind === 'local') {
                const blob = await store.get(track.id);
                if (sequence !== loadSequence) return;
                if (!blob) throw new Error('这个本地文件不在当前浏览器中，请删除该条目并重新导入。');
                objectUrl = URL.createObjectURL(blob);
                source = objectUrl;
            }
            if (sequence !== loadSequence) return;
            if (location.protocol === 'https:' && source.startsWith('http:')) {
                throw new Error('当前酒馆使用 HTTPS，请使用 HTTPS 音乐直链。');
            }
            audio.src = source;
            audio.load();
            if (shouldPlay) await play();
        } catch (error) {
            if (sequence === loadSequence) showStatus(error.message || '读取音乐失败，请重新导入。', true);
        }
    }

    async function removeTrack(id) {
        const index = settings.tracks.findIndex(track => track.id === id);
        if (index < 0) return;
        const track = settings.tracks[index];
        try {
            if (track.kind === 'local') await store.delete(id);
        } catch {
            showStatus('删除本地文件失败，请检查浏览器存储权限后重试。', true);
            return;
        }
        const liveIndex = settings.tracks.findIndex(item => item.id === id);
        if (liveIndex < 0) return;
        const current = settings.currentId === id;
        const wasPlaying = !audio.paused;
        settings.tracks.splice(liveIndex, 1);
        save();
        renderTracks();
        if (current) await selectTrack(settings.tracks[liveIndex % settings.tracks.length]?.id ?? null, wasPlaying);
    }

    async function importFiles(files) {
        if (importing) return;
        importing = true;
        const importButton = query('[data-action="import"]');
        importButton.disabled = true;
        const problems = [];
        let added = 0;
        for (const file of files) {
            try {
                if (settings.tracks.length >= MAX_TRACKS) throw new Error(`播放列表最多可添加 ${MAX_TRACKS} 首音乐。`);
                validateAudioFile(file);
                const id = createTrackId();
                await store.put(id, file);
                settings.tracks.push({ id, kind: 'local', title: file.name.replace(/\.[^.]+$/, '').slice(0, 160) });
                added++;
                save();
            } catch (error) {
                problems.push(`${file.name}：${error.name === 'QuotaExceededError' ? '浏览器存储空间不足，请删除一些本地音乐后重试。' : (error.message || '本地存储失败。')}`);
            }
        }
        if (!settings.currentId && settings.tracks.length) await selectTrack(settings.tracks[0].id);
        renderTracks();
        showStatus([added ? `已导入 ${added} 首音乐。` : '', ...problems].filter(Boolean).join(' '), problems.length > 0);
        importing = false;
        importButton.disabled = false;
        fileInput.value = '';
    }

    launcher.addEventListener('click', () => setOpen(panel.hidden));
    query('[data-action="close"]').addEventListener('click', () => setOpen(false));
    panel.addEventListener('keydown', event => {
        if (event.key === 'Escape') { event.stopPropagation(); setOpen(false); }
    });
    playButton.addEventListener('click', () => {
        if (!audio.paused) audio.pause();
        else if (!audio.getAttribute('src')) void selectTrack(settings.currentId || settings.tracks[0]?.id, true);
        else void play();
    });
    for (const [action, direction] of [['previous', -1], ['next', 1]]) {
        query(`[data-action="${action}"]`).addEventListener('click', () => {
            void selectTrack(nextTrackId(settings.tracks, settings.currentId, settings.mode, { direction }), !audio.paused);
        });
    }
    query('[data-action="import"]').addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', () => void importFiles(Array.from(fileInput.files)));
    query('.stm-url-form').addEventListener('submit', event => {
        event.preventDefault();
        try {
            if (settings.tracks.length >= MAX_TRACKS) throw new Error(`播放列表最多可添加 ${MAX_TRACKS} 首音乐。`);
            const url = normalizeUrl(urlInput.value);
            if (location.protocol === 'https:' && url.startsWith('http:')) throw new Error('请使用 HTTPS 音乐直链。');
            if (settings.tracks.some(track => track.url === url)) throw new Error('这首音乐已经在播放列表中了。');
            const track = { id: createTrackId(), kind: 'url', title: titleFromUrl(url), url };
            settings.tracks.push(track);
            save();
            renderTracks();
            if (!settings.currentId) void selectTrack(track.id);
            urlInput.value = '';
            showStatus('已添加音乐直链。');
        } catch (error) { showStatus(error.message, true); }
    });
    mode.value = settings.mode;
    mode.addEventListener('change', () => { settings.mode = mode.value; save(); });
    function updateVolume() {
        volume.value = String(Math.round(audio.volume * 100));
        query('[data-role="volume"]').textContent = audio.muted ? '静音' : `${volume.value}%`;
        const muteButton = query('[data-action="mute"]');
        muteButton.textContent = audio.muted ? '⊘' : '♪';
        muteButton.setAttribute('aria-label', audio.muted ? '取消静音' : '静音');
        muteButton.title = audio.muted ? '取消静音' : '静音';
    }
    audio.volume = settings.volume;
    updateVolume();
    volume.addEventListener('input', () => {
        audio.volume = Number(volume.value) / 100;
        audio.muted = false;
        settings.volume = audio.volume;
        updateVolume();
        save();
    });
    query('[data-action="mute"]').addEventListener('click', () => { audio.muted = !audio.muted; updateVolume(); });
    seek.addEventListener('input', () => {
        if (Number.isFinite(audio.duration) && audio.duration > 0) audio.currentTime = Number(seek.value);
    });
    for (const event of ['timeupdate', 'loadedmetadata', 'durationchange', 'emptied']) audio.addEventListener(event, updateProgress);
    for (const event of ['play', 'pause', 'ended']) audio.addEventListener(event, updatePlayback);
    audio.addEventListener('ended', () => {
        const nextId = nextTrackId(settings.tracks, settings.currentId, settings.mode, { ended: true });
        if (nextId) void selectTrack(nextId, true);
        else showStatus('播放列表已播放完毕。');
    });
    audio.addEventListener('error', () => {
        if (!audio.getAttribute('src')) return;
        showStatus('音乐加载失败：链接可能失效、需要登录，或浏览器不支持此格式。可尝试下载后导入本地文件。', true);
    });
    window.addEventListener('pagehide', event => {
        // Do not interrupt pages being kept in the browser back/forward cache.
        if (!event.persisted && objectUrl) URL.revokeObjectURL(objectUrl);
    });

    const settingsArea = document.querySelector('#extensions_settings2') || document.querySelector('#extensions_settings');
    if (settingsArea) {
        const entry = document.createElement('div');
        entry.className = 'stm-settings-entry';
        const button = document.createElement('button');
        button.className = 'menu_button';
        button.type = 'button';
        button.textContent = '♫ 打开酒馆音乐播放器';
        button.addEventListener('click', () => setOpen(true));
        entry.append(button);
        settingsArea.append(entry);
    }
    renderTracks();
    if (settings.currentId) void selectTrack(settings.currentId);
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initialize, { once: true });
else initialize();
