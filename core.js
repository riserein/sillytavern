export const MAX_TRACKS = 200;
export const MAX_FILE_BYTES = 100 * 1024 * 1024;
export const PLAY_MODES = ['sequence', 'list', 'single', 'shuffle'];

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

export function normalizeSettings(raw = {}) {
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
    return {
        tracks,
        volume: Math.min(1, Math.max(0, volume)),
        mode: PLAY_MODES.includes(raw.mode) ? raw.mode : 'list',
        currentId: tracks.some(t => t.id === raw.currentId) ? raw.currentId : (tracks[0]?.id ?? null),
    };
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
