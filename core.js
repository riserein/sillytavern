export const MAX_TRACKS = 200;
export const MAX_PLAYLISTS = 50;
export const MAX_FILE_BYTES = 100 * 1024 * 1024;
export const PLAY_MODES = ['sequence', 'list', 'single', 'shuffle'];
export const THEMES = ['amber', 'ocean', 'forest', 'rose', 'lavender', 'pearl'];
export const SURFACES = ['matte', 'glass', 'clear'];
export const THREE_DAYS = 3 * 24 * 60 * 60 * 1000;
export const MAX_RECENT = 100;

function normalizePosition(position) {
    if (!Number.isFinite(position?.x) || !Number.isFinite(position?.y)) return null;
    return { x: Math.min(1, Math.max(0, position.x)), y: Math.min(1, Math.max(0, position.y)) };
}

/** randomUUID is unavailable on some HTTP LAN installations; getRandomValues is not. */
export function createTrackId(source = globalThis.crypto) {
    if (source.randomUUID) return source.randomUUID();
    const bytes = source.getRandomValues(new Uint8Array(16));
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function normalizeUrl(value) {
    let url;
    try {
        url = new URL(String(value).trim());
    } catch {
        throw new Error('请输入完整的音乐直链，例如 https://example.com/music.mp3。');
    }
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) {
        throw new Error('只支持不含账号密码的 HTTP / HTTPS 音乐直链。');
    }
    return url.href;
}

export function titleFromUrl(value) {
    const url = new URL(value);
    let name = url.pathname.split('/').filter(Boolean).at(-1);
    if (!name) return url.hostname;
    try { name = decodeURIComponent(name); } catch { /* Keep malformed percent escapes as text. */ }
    return name.replace(/\.[a-z0-9]{2,5}$/i, '').slice(0, 160) || url.hostname;
}

export function normalizeSettings(raw = {}, now = Date.now()) {
    if (!raw || typeof raw !== 'object') raw = {};
    const ids = new Set();
    const tracks = [];
    for (const item of Array.isArray(raw.tracks) ? raw.tracks : []) {
        if (!item || typeof item.id !== 'string' || !item.id || ids.has(item.id)) continue;
        if (!['local', 'url'].includes(item.kind)) continue;
        let url;
        if (item.kind === 'url') {
            try { url = normalizeUrl(item.url); } catch { continue; }
        }
        ids.add(item.id);
        tracks.push({
            id: item.id,
            kind: item.kind,
            title: String(item.title || '未命名音乐').slice(0, 160),
            ...(url ? { url } : {}),
        });
        if (tracks.length === MAX_TRACKS) break;
    }
    const volume = typeof raw.volume === 'number' && Number.isFinite(raw.volume) ? raw.volume : 0.6;
    const playlistIds = new Set();
    const boundCharacters = new Set();
    const playlists = [];
    for (const item of Array.isArray(raw.playlists) ? raw.playlists : []) {
        if (!item || typeof item.id !== 'string' || !item.id || playlistIds.has(item.id)) continue;
        playlistIds.add(item.id);
        const trackIds = [...new Set(Array.isArray(item.trackIds) ? item.trackIds : [])].filter(id => ids.has(id));
        const characterAvatars = [...new Set(Array.isArray(item.characterAvatars) ? item.characterAvatars : [])]
            .filter(avatar => typeof avatar === 'string' && avatar && !boundCharacters.has(avatar));
        characterAvatars.forEach(avatar => boundCharacters.add(avatar));
        playlists.push({
            id: item.id,
            name: String(item.name || '未命名歌单').trim().slice(0, 80) || '未命名歌单',
            trackIds,
            characterAvatars,
            lastTrackId: trackIds.includes(item.lastTrackId) ? item.lastTrackId : (trackIds[0] ?? null),
        });
        if (playlists.length === MAX_PLAYLISTS) break;
    }
    const activePlaylist = playlists.find(playlist => playlist.id === raw.activePlaylistId);
    const activeTracks = activePlaylist ? tracks.filter(track => activePlaylist.trackIds.includes(track.id)) : tracks;
    const currentId = activeTracks.some(track => track.id === raw.currentId) ? raw.currentId
        : (activePlaylist?.lastTrackId ?? activeTracks[0]?.id ?? null);
    const backgroundId = typeof raw.backgroundId === 'string' && /^background:[a-f0-9-]{36}$/.test(raw.backgroundId) ? raw.backgroundId : null;
    return {
        tracks,
        playlists,
        activePlaylistId: activePlaylist?.id ?? null,
        volume: Math.min(1, Math.max(0, volume)),
        mode: PLAY_MODES.includes(raw.mode) ? raw.mode : 'list',
        currentId,
        theme: THEMES.includes(raw.theme) ? raw.theme : 'amber',
        surface: SURFACES.includes(raw.surface) && (raw.surface !== 'clear' || backgroundId) ? raw.surface : 'glass',
        backgroundId,
        ...normalizeHistory(raw, ids, now),
        positions: {
            launcher: normalizePosition(raw.positions?.launcher),
            panel: normalizePosition(raw.positions?.panel),
        },
    };
}

export function getQueue(settings, playlistId = settings.activePlaylistId) {
    const playlist = settings.playlists.find(item => item.id === playlistId);
    if (!playlist) return settings.tracks;
    const tracksById = new Map(settings.tracks.map(track => [track.id, track]));
    return playlist.trackIds.map(id => tracksById.get(id)).filter(Boolean);
}

export function createPlaylist(settings, name, id = createTrackId()) {
    name = String(name).trim();
    if (!name || name.length > 80) throw new Error('歌单名称需要 1 至 80 个字符。');
    if (name === '总曲库' || settings.playlists.some(item => item.name === name)) throw new Error('这个歌单名称已被使用。');
    if (settings.playlists.length >= MAX_PLAYLISTS) throw new Error(`最多可以创建 ${MAX_PLAYLISTS} 个歌单。`);
    const playlist = { id, name, trackIds: [], characterAvatars: [], lastTrackId: null };
    settings.playlists.push(playlist);
    return playlist;
}

export function addTrackToPlaylist(settings, playlistId, trackId) {
    const playlist = settings.playlists.find(item => item.id === playlistId);
    if (!playlist || !settings.tracks.some(track => track.id === trackId)) return false;
    if (playlist.trackIds.includes(trackId)) return false;
    playlist.trackIds.push(trackId);
    playlist.lastTrackId ??= trackId;
    return true;
}

export function renamePlaylist(settings, playlistId, name) {
    const playlist = settings.playlists.find(item => item.id === playlistId);
    if (!playlist) return;
    name = String(name).trim();
    if (!name || name.length > 80) throw new Error('歌单名称需要 1 至 80 个字符。');
    if (name === '总曲库' || settings.playlists.some(item => item.id !== playlistId && item.name === name)) throw new Error('这个歌单名称已被使用。');
    playlist.name = name;
}

export function removeTrackFromPlaylist(settings, playlistId, trackId) {
    const playlist = settings.playlists.find(item => item.id === playlistId);
    if (!playlist) return;
    playlist.trackIds = playlist.trackIds.filter(id => id !== trackId);
    if (playlist.lastTrackId === trackId) playlist.lastTrackId = playlist.trackIds[0] ?? null;
}

export function deleteTrackFromLibrary(settings, trackId) {
    settings.tracks = settings.tracks.filter(track => track.id !== trackId);
    for (const playlist of settings.playlists) removeTrackFromPlaylist(settings, playlist.id, trackId);
    if (settings.currentId === trackId) settings.currentId = null;
    settings.recentPlays = settings.recentPlays.filter(item => item.trackId !== trackId);
    settings.playEvents = settings.playEvents.filter(item => item.trackId !== trackId);
}

function normalizeHistory(raw, ids, now) {
    const valid = item => item && ids.has(item.trackId) && Number.isFinite(item.at) && item.at > 0 && item.at <= now;
    const seen = new Set();
    const recentPlays = (Array.isArray(raw.recentPlays) ? raw.recentPlays : []).filter(valid)
        .sort((a, b) => b.at - a.at).filter(item => {
            if (seen.has(item.trackId)) return false;
            seen.add(item.trackId);
            return true;
        }).slice(0, MAX_RECENT).map(({ trackId, at }) => ({ trackId, at }));
    const playEvents = (Array.isArray(raw.playEvents) ? raw.playEvents : []).filter(item => valid(item) && item.at > now - THREE_DAYS)
        .map(({ trackId, at }) => ({ trackId, at }));
    return { recentPlays, playEvents };
}

/** Call only after audio starts playing, once per song selection or repeat. */
export function recordPlayback(settings, trackId, now = Date.now()) {
    const ids = new Set(settings.tracks.map(track => track.id));
    if (!ids.has(trackId)) return;
    Object.assign(settings, normalizeHistory(settings, ids, now));
    settings.recentPlays = [{ trackId, at: now }, ...settings.recentPlays.filter(item => item.trackId !== trackId)].slice(0, MAX_RECENT);
    settings.playEvents.push({ trackId, at: now });
}

export function recentTracks(settings) {
    const byId = new Map(settings.tracks.map(track => [track.id, track]));
    return settings.recentPlays.filter(item => byId.has(item.trackId))
        .map(item => ({ track: byId.get(item.trackId), at: item.at }));
}

export function rankedTracks(settings, now = Date.now()) {
    const counts = new Map();
    for (const { trackId, at } of settings.playEvents) {
        if (at <= now - THREE_DAYS || at > now) continue;
        const item = counts.get(trackId) || { count: 0, at: 0 };
        item.count++;
        item.at = Math.max(item.at, at);
        counts.set(trackId, item);
    }
    return settings.tracks.filter(track => counts.has(track.id)).map(track => ({ track, ...counts.get(track.id) }))
        .sort((a, b) => b.count - a.count || b.at - a.at || a.track.id.localeCompare(b.track.id));
}

export function deletePlaylist(settings, playlistId) {
    settings.playlists = settings.playlists.filter(playlist => playlist.id !== playlistId);
    if (settings.activePlaylistId === playlistId) settings.activePlaylistId = null;
}

/** A card has one automatic playlist; a playlist may be shared by any number of cards. */
export function bindPlaylistCharacters(settings, playlistId, avatars) {
    const playlist = settings.playlists.find(item => item.id === playlistId);
    if (!playlist) return;
    const selected = [...new Set(avatars)].filter(avatar => typeof avatar === 'string' && avatar);
    for (const item of settings.playlists) {
        item.characterAvatars = item.id === playlistId ? selected : item.characterAvatars.filter(avatar => !selected.includes(avatar));
    }
}

export function currentCharacterAvatar(context) {
    if ((context.groupId !== undefined && context.groupId !== null && context.groupId !== '') || context.characterId === undefined || context.characterId === null) return null;
    const avatar = context.characters?.[context.characterId]?.avatar;
    return typeof avatar === 'string' && avatar && avatar !== 'none' ? avatar : null;
}

export function playlistForCharacter(settings, avatar) {
    return avatar ? settings.playlists.find(playlist => playlist.characterAvatars.includes(avatar)) ?? null : null;
}

/** Single repeat applies to automatic completion; manual navigation still changes songs. */
export function nextTrackId(tracks, currentId, mode, { direction = 1, ended = false, random = Math.random } = {}) {
    if (!tracks.length) return null;
    const index = tracks.findIndex(t => t.id === currentId);
    if (index < 0) return tracks[0].id;
    if (ended && mode === 'single') return currentId;
    if (mode === 'shuffle' && tracks.length > 1) {
        const offset = 1 + Math.min(tracks.length - 2, Math.max(0, Math.floor(random() * (tracks.length - 1))));
        return tracks[(index + offset) % tracks.length].id;
    }
    if (ended && mode === 'sequence' && index === tracks.length - 1) return null;
    return tracks[(index + direction + tracks.length) % tracks.length].id;
}

export function formatTime(seconds) {
    if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
    const total = Math.floor(seconds);
    return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

export function validateAudioFile(file) {
    if (!file || (!file.type?.startsWith('audio/') && !/\.(mp3|wav|ogg|oga|m4a|aac|flac|opus|webm)$/i.test(file.name))) {
        throw new Error('请选择音频文件，例如 MP3、WAV、OGG 或 M4A。');
    }
    if (!file.size) throw new Error('不能导入空文件。');
    if (file.size > MAX_FILE_BYTES) throw new Error('单个音乐文件不能超过 100 MB。');
}
