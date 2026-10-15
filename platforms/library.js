import { normalizePlatformTrack, sourceKey } from './catalog.js';
export const BUILTIN_ID = '@builtin';
export function normalizeBuiltinCatalog(raw = {}) {
    if (!raw || typeof raw !== 'object') raw = {};
    const seen = new Set(),
        tracks = [];
    for (const value of Array.isArray(raw.tracks) ? raw.tracks : []) {
        const track = normalizePlatformTrack(value);
        if (track && !seen.has(track.id)) {
            track.fallbackCover = [...track.id].reduce((sum, char) => (sum + char.charCodeAt(0)) % 3, 0);
            tracks.push(track);
            seen.add(track.id);
        }
    }
    return {
        version: Number.isSafeInteger(raw.version) && raw.version >= 0 ? raw.version : 0,
        title: String(raw.title || '默认曲库').slice(0, 80),
        tracks,
    };
}
export const allTracks = (settings) => [
    ...settings.tracks,
    ...(settings.builtinCatalog?.tracks || []).filter((track) => !settings.tracks.some((own) => own.id === track.id)),
];
export const findTrack = (settings, id) =>
    settings.tracks.find((track) => track.id === id) ||
    settings.builtinCatalog?.tracks.find((track) => track.id === id);
export function planImport(settings, preview, { targetId = null, newPlaylist = false, name = preview.name } = {}) {
    if (!preview.complete || preview.tracks.length !== preview.total)
        throw new Error('歌曲列表尚未读取完整，不能保存。');
    const tracks = preview.tracks.map(normalizePlatformTrack);
    if (tracks.some((track) => !track)) throw new Error('部分歌曲信息无效，不能保存。');
    const seen = new Set(settings.tracks.map((track) => track.id));
    const added = tracks.filter((track) => {
        if (seen.has(track.id)) return false;
        seen.add(track.id);
        return true;
    });
    if (settings.tracks.length + added.length > 200)
        throw new Error(`总曲库最多 200 首，本次新增 ${added.length} 首会超出上限；没有导入任何歌曲。`);
    let existing;
    if (newPlaylist) {
        if (!preview.source) throw new Error('缺少原歌单来源，不能创建导入歌单。');
        existing = settings.playlists.find(
            (item) => item.source && sourceKey(item.source) === sourceKey(preview.source),
        );
        name = String(name).trim();
        if (
            !existing &&
            (!name || name.length > 80 || name === '总曲库' || settings.playlists.some((item) => item.name === name))
        )
            throw new Error('歌单名称需要 1 至 80 个字符，且不能与已有歌单重名。');
        if (!existing && settings.playlists.length >= 50) throw new Error('自建歌单数量已达 50 个，没有导入任何歌曲。');
    } else if (targetId && !settings.playlists.some((item) => item.id === targetId))
        throw new Error('目标歌单已删除，请重新选择。');
    return {
        tracks,
        added,
        targetId: existing?.id || targetId,
        newPlaylist: newPlaylist && !existing,
        name,
        source: preview.source,
    };
}
