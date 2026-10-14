import {
    MAX_TRACKS, createTrackId, normalizeSettings, normalizeUrl, titleFromUrl, nextTrackId, formatTime, validateAudioFile,
    getQueue, createPlaylist, renamePlaylist, addTrackToPlaylist, removeTrackFromPlaylist, deleteTrackFromLibrary,
    deletePlaylist, bindPlaylistCharacters, currentCharacterAvatar, playlistForCharacter,
} from './core.js';
import { LocalMusicStore } from './local-store.js';
import { makeDraggable } from './floating.js';

const SETTINGS_KEY = 'riserein_music_player';

function initialize() {
    if (document.getElementById('stm-player')) return;
    const context = globalThis.SillyTavern?.getContext();
    if (!context?.extensionSettings || !context.saveSettingsDebounced) {
        console.error('[音乐播放器] 无法获取酒馆扩展接口，请更新 SillyTavern。');
        return;
    }

    const settings = normalizeSettings(context.extensionSettings[SETTINGS_KEY]);
    const store = new LocalMusicStore();
    let objectUrl = null;
    let loadSequence = 0;
    let importing = false;
    let viewRevision = 0;
    let lastRoleAvatar = null;
    let roleRevision = 0;
    let canAutoAdvance = true;
    let membershipTrackId = null;

    const launcher = document.createElement('button');
    launcher.id = 'stm-launcher';
    launcher.type = 'button';
    launcher.className = 'stm-launcher';
    launcher.textContent = '♫';
    launcher.title = '点击打开音乐播放器，拖动可移动';
    launcher.setAttribute('aria-label', '打开音乐播放器');
    launcher.setAttribute('aria-controls', 'stm-player');
    launcher.setAttribute('aria-expanded', 'false');

    const panel = document.createElement('section');
    panel.id = 'stm-player';
    panel.className = 'stm-player';
    panel.hidden = true;
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-label', '音乐播放器');
    panel.innerHTML = `
        <header class="stm-header" tabindex="0" aria-label="拖动播放器窗口，可用方向键移动" title="拖动这里移动窗口">
            <span class="stm-grip" aria-hidden="true">⠿</span>
            <div class="stm-header-actions">
                <button type="button" class="stm-secondary" data-action="appearance" aria-expanded="false" aria-controls="stm-appearance">◐ 配色</button>
                <button type="button" class="stm-icon" data-action="close" aria-label="关闭播放器" title="关闭面板，音乐继续播放">×</button>
            </div>
        </header>
        <div id="stm-appearance" class="stm-appearance" hidden>
            <div class="stm-theme-grid" role="group" aria-label="选择配色"></div>
            <div class="stm-surface-row" role="group" aria-label="选择质感">
                <button type="button" class="stm-secondary" data-surface-choice="matte">雾面</button>
                <button type="button" class="stm-secondary" data-surface-choice="glass">毛玻璃</button>
                <button type="button" class="stm-secondary stm-reset-position" data-action="reset-position">重置位置</button>
            </div>
        </div>
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
        <div class="stm-library-nav">
            <label class="stm-sr-only" for="stm-playlist">选择歌单</label>
            <select id="stm-playlist"><option value="">总曲库</option></select>
            <button type="button" class="stm-secondary" data-action="manage-playlists" aria-expanded="false" aria-controls="stm-playlist-manager">歌单管理</button>
        </div>
        <p class="stm-role-status" data-role="role-status"></p>
        <div id="stm-playlist-manager" class="stm-playlist-manager" hidden>
            <form class="stm-create-playlist stm-inline-form">
                <label class="stm-sr-only" for="stm-new-playlist">新歌单名称</label>
                <input id="stm-new-playlist" placeholder="新歌单名称" maxlength="80" required autocomplete="off">
                <button type="submit" class="stm-secondary">新建</button>
            </form>
            <div class="stm-playlist-editor" hidden>
                <form class="stm-rename-playlist stm-inline-form">
                    <label class="stm-sr-only" for="stm-playlist-name">修改歌单名称</label>
                    <input id="stm-playlist-name" maxlength="80" required autocomplete="off">
                    <button type="submit" class="stm-secondary">保存名称</button>
                </form>
                <div class="stm-playlist-actions">
                    <button type="button" class="stm-secondary" data-action="bind-roles" aria-expanded="false" aria-controls="stm-role-bindings">绑定角色</button>
                    <button type="button" class="stm-secondary stm-danger" data-action="delete-playlist">删除歌单</button>
                </div>
                <form id="stm-role-bindings" hidden>
                    <p class="stm-hint">可勾选多个角色。角色已有绑定时，保存后会改用这个歌单。</p>
                    <div class="stm-role-picker"></div>
                    <button type="submit" class="stm-secondary">保存绑定</button>
                </form>
            </div>
            <p class="stm-hint">删除歌单保留全部歌曲。进入绑定角色时只切歌单，音乐需手动播放。</p>
        </div>
        <div class="stm-import-target">
            <label for="stm-import-playlist">导入到</label>
            <select id="stm-import-playlist"><option value="">不选择 · 仅加入总曲库</option></select>
        </div>
        <div class="stm-list-heading"><h3><span data-role="collection-title">总曲库</span> <span data-role="count">0</span></h3>
            <button type="button" class="stm-secondary" data-action="import">＋ 本地音乐</button>
            <input type="file" data-role="files" accept="audio/*,.mp3,.wav,.ogg,.oga,.m4a,.aac,.flac,.opus,.webm" multiple hidden>
        </div>
        <form class="stm-url-form">
            <label class="stm-sr-only" for="stm-url">音乐直链</label>
            <input id="stm-url" type="url" placeholder="粘贴音乐直链（HTTP / HTTPS）" required autocomplete="off">
            <button type="submit" class="stm-secondary">添加</button>
        </form>
        <p class="stm-hint">支持音频直链，不支持网易云、QQ 音乐等歌曲分享页。</p>
        <div class="stm-membership" hidden>
            <span class="stm-hint" data-role="membership-title"></span>
            <div class="stm-inline-form">
                <label class="stm-sr-only" for="stm-add-target">加入哪个歌单</label>
                <select id="stm-add-target"></select>
                <button type="button" class="stm-secondary" data-action="confirm-membership">加入歌单</button>
                <button type="button" class="stm-icon" data-action="close-membership" aria-label="取消加入歌单">×</button>
            </div>
        </div>
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
    const playlistSelect = query('#stm-playlist');
    const importTarget = query('#stm-import-playlist');

    function save() {
        context.extensionSettings[SETTINGS_KEY] = settings;
        context.saveSettingsDebounced();
    }

    const launcherDrag = makeDraggable(launcher, launcher, {
        getPosition: () => settings.positions.launcher,
        onPositionChange: position => { settings.positions.launcher = position; save(); },
    });
    const panelDrag = makeDraggable(panel, query('.stm-header'), {
        getPosition: () => settings.positions.panel,
        onPositionChange: position => { settings.positions.panel = position; save(); },
    });
    const themes = { amber: '暖砂', ocean: '雾蓝', forest: '松绿', rose: '烟粉', lavender: '月紫', pearl: '珍珠白' };
    for (const [theme, name] of Object.entries(themes)) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'stm-theme-choice';
        button.dataset.theme = theme;
        button.dataset.themeChoice = theme;
        button.setAttribute('aria-label', `配色：${name}`);
        const swatch = document.createElement('span');
        swatch.className = 'stm-swatch';
        swatch.setAttribute('aria-hidden', 'true');
        const label = document.createElement('span');
        label.textContent = name;
        button.append(swatch, label);
        button.addEventListener('click', () => { settings.theme = theme; applyAppearance(); save(); });
        query('.stm-theme-grid').append(button);
    }
    function applyAppearance() {
        for (const element of [panel, launcher]) {
            element.dataset.theme = settings.theme;
            element.dataset.surface = settings.surface;
        }
        for (const button of panel.querySelectorAll('[data-theme-choice]')) {
            button.setAttribute('aria-pressed', String(button.dataset.themeChoice === settings.theme));
        }
        for (const button of panel.querySelectorAll('[data-surface-choice]')) {
            button.setAttribute('aria-pressed', String(button.dataset.surfaceChoice === settings.surface));
        }
    }
    query('[data-action="appearance"]').addEventListener('click', event => {
        const options = query('#stm-appearance');
        options.hidden = !options.hidden;
        event.currentTarget.setAttribute('aria-expanded', String(!options.hidden));
        panelDrag.refresh();
    });
    for (const button of panel.querySelectorAll('[data-surface-choice]')) {
        button.addEventListener('click', () => { settings.surface = button.dataset.surfaceChoice; applyAppearance(); save(); });
    }
    query('[data-action="reset-position"]').addEventListener('click', () => {
        settings.positions = { launcher: null, panel: null };
        launcherDrag.reset();
        panelDrag.reset();
        save();
    });
    applyAppearance();

    function showStatus(message = '', error = false) {
        status.textContent = message;
        status.classList.toggle('stm-error', error);
    }

    function setOpen(open, focus = true) {
        panel.hidden = !open;
        launcher.setAttribute('aria-expanded', String(open));
        if (open) { panelDrag.refresh(); if (focus) query('[data-action="close"]').focus(); }
        else if (panel.contains(document.activeElement)) launcher.focus();
    }

    const activePlaylist = () => settings.playlists.find(item => item.id === settings.activePlaylistId);
    const freshContext = () => globalThis.SillyTavern.getContext();

    function renderRoleStatus() {
        const current = freshContext();
        const avatar = currentCharacterAvatar(current);
        const binding = playlistForCharacter(settings, avatar);
        const name = current.characters?.[current.characterId]?.name || '当前角色';
        query('[data-role="role-status"]').textContent = avatar
            ? `${name} · ${binding ? `绑定「${binding.name}」` : '未绑定歌单'}`
            : `总曲库 ${settings.tracks.length} 首 · 进入角色自动切换绑定歌单`;
    }

    function renderRolePicker() {
        const selected = activePlaylist();
        const picker = query('.stm-role-picker');
        picker.replaceChildren();
        if (!selected) return;
        const characters = new Map((freshContext().characters || [])
            .filter(character => character.avatar && character.avatar !== 'none')
            .map(character => [character.avatar, character.name || character.avatar]));
        for (const avatar of selected.characterAvatars) {
            if (!characters.has(avatar)) characters.set(avatar, `${avatar}（角色暂不在列表中）`);
        }
        for (const [avatar, name] of characters) {
            const label = document.createElement('label');
            const checkbox = document.createElement('input');
            checkbox.type = 'checkbox';
            checkbox.dataset.avatar = avatar;
            checkbox.checked = selected.characterAvatars.includes(avatar);
            checkbox.setAttribute('aria-label', `${name}（${avatar}）`);
            const caption = document.createElement('span');
            caption.textContent = name;
            const binding = playlistForCharacter(settings, avatar);
            if (binding && binding.id !== selected.id) {
                const note = document.createElement('small');
                note.textContent = `当前绑定：${binding.name}`;
                caption.append(note);
            }
            label.append(checkbox, caption);
            picker.append(label);
        }
        if (!characters.size) picker.textContent = '酒馆中还没有角色卡，请先添加角色。';
    }

    function renderPlaylists() {
        const importId = importTarget.value;
        const membershipId = query('#stm-add-target').value;
        for (const [select, libraryName] of [[playlistSelect, '总曲库'], [importTarget, '不选择 · 仅加入总曲库'], [query('#stm-add-target'), null]]) {
            select.replaceChildren();
            if (libraryName) select.append(new Option(libraryName, ''));
            for (const playlist of settings.playlists) select.append(new Option(`${playlist.name}（${playlist.trackIds.length}）`, playlist.id));
        }
        playlistSelect.value = settings.activePlaylistId || '';
        importTarget.value = settings.playlists.some(item => item.id === importId) ? importId : '';
        if (settings.playlists.some(item => item.id === membershipId)) query('#stm-add-target').value = membershipId;
        const selected = activePlaylist();
        query('.stm-playlist-editor').hidden = !selected;
        if (selected) query('#stm-playlist-name').value = selected.name;
        if (!settings.playlists.length || !settings.tracks.some(track => track.id === membershipTrackId)) query('.stm-membership').hidden = true;
        renderRoleStatus();
        renderRolePicker();
    }

    async function activatePlaylist(id, open = false) {
        settings.activePlaylistId = settings.playlists.some(playlist => playlist.id === id) ? id : null;
        const revision = ++viewRevision;
        pausePlayback();
        query('.stm-membership').hidden = true;
        renderPlaylists();
        if (open) setOpen(true, false);
        const queue = getQueue(settings);
        const selected = activePlaylist();
        const track = queue.find(item => item.id === settings.currentId)
            || queue.find(item => item.id === selected?.lastTrackId) || queue[0];
        if (track?.id !== settings.currentId || (!audio.getAttribute('src') && track)) await selectTrack(track?.id ?? null);
        else { save(); renderTracks(); }
        return revision === viewRevision;
    }

    function pausePlayback() {
        loadSequence++;
        canAutoAdvance = false;
        audio.pause();
    }

    async function syncRole(force = false) {
        const avatar = currentCharacterAvatar(freshContext());
        if (!force && avatar === lastRoleAvatar) { renderRoleStatus(); return; }
        const previous = lastRoleAvatar;
        lastRoleAvatar = avatar;
        const revision = ++roleRevision;
        viewRevision++;
        if (avatar) {
            pausePlayback();
            const binding = playlistForCharacter(settings, avatar);
            const activated = await activatePlaylist(binding?.id ?? null, Boolean(binding));
            if (!activated || revision !== roleRevision) return;
            if (binding) showStatus(`已打开「${binding.name}」，点击播放开始听歌。`);
        } else if (previous) {
            pausePlayback();
            showStatus('已离开角色聊天，音乐已暂停。');
        }
        renderRoleStatus();
    }

    function renderTracks() {
        list.replaceChildren();
        const queue = getQueue(settings);
        for (const track of queue) {
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
            remove.title = '从总曲库及所有歌单删除此音乐';
            remove.addEventListener('click', () => void removeTrack(track.id));
            row.append(button);
            if (activePlaylist()) {
                const unlink = document.createElement('button');
                unlink.type = 'button';
                unlink.className = 'stm-icon';
                unlink.textContent = '−';
                unlink.title = '仅从此歌单移除，保留曲库歌曲';
                unlink.setAttribute('aria-label', `从歌单移除：${track.title}`);
                unlink.addEventListener('click', () => void unlinkTrack(track.id));
                row.append(unlink);
            } else {
                const add = document.createElement('button');
                add.type = 'button';
                add.className = 'stm-icon';
                add.textContent = '+';
                add.disabled = !settings.playlists.length;
                add.title = settings.playlists.length ? '加入已有歌单' : '请先新建歌单';
                add.setAttribute('aria-label', `加入歌单：${track.title}`);
                add.addEventListener('click', () => {
                    membershipTrackId = track.id;
                    query('[data-role="membership-title"]').textContent = `将「${track.title}」加入：`;
                    query('.stm-membership').hidden = false;
                    query('#stm-add-target').focus();
                });
                row.append(add);
            }
            row.append(remove);
            list.append(row);
        }
        query('[data-role="collection-title"]').textContent = activePlaylist()?.name || '总曲库';
        query('[data-role="count"]').textContent = String(queue.length);
        query('.stm-empty').hidden = queue.length > 0;
        query('.stm-empty').textContent = activePlaylist() ? '此歌单还没有歌曲，请选择导入目标，或从总曲库添加。' : '曲库还是空的，导入本地音乐或添加直链开始吧。';
        playButton.disabled = queue.length === 0;
        query('[data-action="previous"]').disabled = queue.length === 0;
        query('[data-action="next"]').disabled = queue.length === 0;
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
        launcher.title = playing ? '正在播放音乐 · 点击打开，拖动可移动' : '点击打开音乐播放器，拖动可移动';
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
        const sequence = loadSequence;
        canAutoAdvance = true;
        try {
            await audio.play();
            if (sequence === loadSequence) showStatus();
        } catch (error) {
            if (error.name === 'AbortError' || sequence !== loadSequence) return;
            showStatus(error.name === 'NotAllowedError'
                ? '浏览器阻止了自动播放，请再点一次“播放”。'
                : '无法播放此音乐，请检查格式或直链是否可访问。', true);
        }
    }

    async function selectTrack(id, shouldPlay = false) {
        const sequence = ++loadSequence;
        canAutoAdvance = true;
        releaseSource();
        const track = getQueue(settings).find(item => item.id === id);
        settings.currentId = track?.id ?? null;
        const playlist = activePlaylist();
        if (playlist && track) playlist.lastTrackId = track.id;
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
        const track = settings.tracks.find(item => item.id === id);
        if (!track) return;
        if (!window.confirm(`从总曲库删除「${track.title}」？\n这首歌也会从所有歌单中移除。`)) return;
        try {
            if (track.kind === 'local') await store.delete(id);
        } catch {
            showStatus('删除本地文件失败，请检查浏览器存储权限后重试。', true);
            return;
        }
        if (!settings.tracks.some(item => item.id === id)) return;
        const liveIndex = getQueue(settings).findIndex(item => item.id === id);
        const current = settings.currentId === id;
        const wasPlaying = !audio.paused;
        deleteTrackFromLibrary(settings, id);
        save();
        renderPlaylists();
        renderTracks();
        const queue = getQueue(settings);
        if (current) await selectTrack(queue.length ? queue[Math.max(0, liveIndex) % queue.length].id : null, wasPlaying);
    }

    async function unlinkTrack(id) {
        const playlist = activePlaylist();
        if (!playlist) return;
        const index = getQueue(settings).findIndex(track => track.id === id);
        const current = settings.currentId === id;
        const wasPlaying = !audio.paused;
        removeTrackFromPlaylist(settings, playlist.id, id);
        save();
        renderPlaylists();
        renderTracks();
        const queue = getQueue(settings);
        if (current) await selectTrack(queue.length ? queue[Math.max(0, index) % queue.length].id : null, wasPlaying);
        showStatus('已从此歌单移除，歌曲仍保留在总曲库。');
    }

    async function finishImport(targetId, revision) {
        const target = settings.playlists.find(item => item.id === targetId);
        const destinationId = target?.id ?? null;
        renderPlaylists();
        if (revision === viewRevision) {
            if (settings.activePlaylistId !== destinationId) await activatePlaylist(destinationId);
            else if (!settings.currentId && getQueue(settings).length) await selectTrack(getQueue(settings)[0].id);
        }
        renderTracks();
        return target;
    }

    async function importFiles(files) {
        if (importing) return;
        importing = true;
        const importButton = query('[data-action="import"]');
        importButton.disabled = true;
        const problems = [];
        let added = 0;
        const targetId = importTarget.value || null;
        const revision = viewRevision;
        for (const file of files) {
            try {
                if (settings.tracks.length >= MAX_TRACKS) throw new Error(`总曲库最多可添加 ${MAX_TRACKS} 首音乐。`);
                validateAudioFile(file);
                const id = createTrackId();
                await store.put(id, file);
                if (settings.tracks.length >= MAX_TRACKS) {
                    await store.delete(id);
                    throw new Error(`总曲库最多可添加 ${MAX_TRACKS} 首音乐。`);
                }
                settings.tracks.push({ id, kind: 'local', title: file.name.replace(/\.[^.]+$/, '').slice(0, 160) });
                addTrackToPlaylist(settings, targetId, id);
                added++;
                save();
            } catch (error) {
                problems.push(`${file.name}：${error.name === 'QuotaExceededError' ? '浏览器存储空间不足，请删除一些本地音乐后重试。' : (error.message || '本地存储失败。')}`);
            }
        }
        const target = added ? await finishImport(targetId, revision) : settings.playlists.find(item => item.id === targetId);
        if (!added) { renderPlaylists(); renderTracks(); }
        showStatus([added ? `已导入 ${added} 首音乐${target ? `，并加入「${target.name}」` : '到总曲库'}。` : '',
            targetId && !target ? '目标歌单已删除，歌曲保留在总曲库。' : '', ...problems].filter(Boolean).join(' '), problems.length > 0);
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
        else if (!audio.getAttribute('src')) void selectTrack(settings.currentId || getQueue(settings)[0]?.id, true);
        else void play();
    });
    for (const [action, direction] of [['previous', -1], ['next', 1]]) {
        query(`[data-action="${action}"]`).addEventListener('click', () => {
            void selectTrack(nextTrackId(getQueue(settings), settings.currentId, settings.mode, { direction }), !audio.paused);
        });
    }
    query('[data-action="import"]').addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', () => void importFiles(Array.from(fileInput.files)));
    query('.stm-url-form').addEventListener('submit', async event => {
        event.preventDefault();
        try {
            const url = normalizeUrl(urlInput.value);
            if (location.protocol === 'https:' && url.startsWith('http:')) throw new Error('请使用 HTTPS 音乐直链。');
            const targetId = importTarget.value || null;
            const revision = viewRevision;
            let track = settings.tracks.find(item => item.url === url);
            if (track && !targetId) throw new Error('这首音乐已经在总曲库中了。');
            if (!track) {
                if (settings.tracks.length >= MAX_TRACKS) throw new Error(`总曲库最多可添加 ${MAX_TRACKS} 首音乐。`);
                track = { id: createTrackId(), kind: 'url', title: titleFromUrl(url), url };
                settings.tracks.push(track);
            }
            addTrackToPlaylist(settings, targetId, track.id);
            save();
            urlInput.value = '';
            const target = await finishImport(targetId, revision);
            showStatus(target ? `已将音乐加入「${target.name}」，总曲库也保留此歌曲。` : '已添加音乐直链到总曲库。');
        } catch (error) { showStatus(error.message, true); }
    });

    playlistSelect.addEventListener('change', () => void activatePlaylist(playlistSelect.value || null));
    query('[data-action="manage-playlists"]').addEventListener('click', event => {
        const manager = query('#stm-playlist-manager');
        manager.hidden = !manager.hidden;
        event.currentTarget.setAttribute('aria-expanded', String(!manager.hidden));
        renderRolePicker();
    });
    query('.stm-create-playlist').addEventListener('submit', async event => {
        event.preventDefault();
        try {
            const playlist = createPlaylist(settings, query('#stm-new-playlist').value);
            query('#stm-new-playlist').value = '';
            save();
            await activatePlaylist(playlist.id);
            showStatus(`已创建「${playlist.name}」。导入前可在“导入到”中选择这个歌单。`);
        } catch (error) { showStatus(error.message, true); }
    });
    query('.stm-rename-playlist').addEventListener('submit', event => {
        event.preventDefault();
        try {
            renamePlaylist(settings, settings.activePlaylistId, query('#stm-playlist-name').value);
            save(); renderPlaylists(); renderTracks();
            showStatus('歌单名称已保存。');
        } catch (error) { showStatus(error.message, true); }
    });
    query('[data-action="delete-playlist"]').addEventListener('click', async () => {
        const selected = activePlaylist();
        if (!selected || !window.confirm(`删除歌单「${selected.name}」？\n歌曲将全部保留在总曲库，角色绑定会解除。`)) return;
        const wasActive = settings.activePlaylistId === selected.id;
        deletePlaylist(settings, selected.id);
        save();
        renderPlaylists();
        if (wasActive) await activatePlaylist(null);
        renderTracks();
        showStatus('歌单已删除，歌曲全部保留在总曲库。');
    });
    query('[data-action="bind-roles"]').addEventListener('click', event => {
        const form = query('#stm-role-bindings');
        form.hidden = !form.hidden;
        event.currentTarget.setAttribute('aria-expanded', String(!form.hidden));
        renderRolePicker();
    });
    query('#stm-role-bindings').addEventListener('submit', async event => {
        event.preventDefault();
        bindPlaylistCharacters(settings, settings.activePlaylistId, Array.from(panel.querySelectorAll('.stm-role-picker input:checked'), input => input.dataset.avatar));
        save(); renderPlaylists();
        await syncRole(true);
        showStatus('角色绑定已保存。进入角色只切换歌单，音乐需手动播放。');
    });
    query('[data-action="confirm-membership"]').addEventListener('click', () => {
        const targetId = query('#stm-add-target').value;
        const added = addTrackToPlaylist(settings, targetId, membershipTrackId);
        save(); renderPlaylists(); renderTracks();
        query('.stm-membership').hidden = true;
        showStatus(added ? '已加入歌单，曲库歌曲保留不变。' : '这首歌已在所选歌单中。');
    });
    query('[data-action="close-membership"]').addEventListener('click', () => { query('.stm-membership').hidden = true; });
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
        if (!canAutoAdvance) return;
        const nextId = nextTrackId(getQueue(settings), settings.currentId, settings.mode, { ended: true });
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
        button.textContent = '♫ 打开音乐播放器';
        button.addEventListener('click', () => setOpen(true));
        entry.append(button);
        settingsArea.append(entry);
    }
    if (context.eventSource && context.eventTypes) {
        // Music file reads must not delay the host's chat navigation.
        context.eventSource.on(context.eventTypes.CHAT_CHANGED, () => { void syncRole(); });
        context.eventSource.on(context.eventTypes.APP_READY, () => { void syncRole(true); });
        if (context.eventTypes.CHARACTER_RENAMED) {
            context.eventSource.on(context.eventTypes.CHARACTER_RENAMED, (oldAvatar, newAvatar) => {
                if (typeof oldAvatar !== 'string' || typeof newAvatar !== 'string') return;
                for (const playlist of settings.playlists) playlist.characterAvatars = playlist.characterAvatars.map(avatar => avatar === oldAvatar ? newAvatar : avatar);
                if (lastRoleAvatar === oldAvatar) lastRoleAvatar = newAvatar;
                save(); renderPlaylists();
            });
        }
    }
    renderPlaylists();
    renderTracks();
    if (settings.currentId) void selectTrack(settings.currentId);
    if (!document.getElementById('preloader')) void syncRole(true);
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initialize, { once: true });
else initialize();
