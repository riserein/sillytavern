import { normalizePlatformTrack } from './catalog.js';
export async function buildBuiltinCatalog(service, sources, { title = '默认曲库', previous = { version: 0 } } = {}) {
    if (!sources.length) throw new Error('至少提供一个正式歌曲或歌单链接。');
    const tracks = [],
        seen = new Set();
    for (const source of sources) {
        const preview = await service.preview(source);
        if (!preview.complete || preview.total !== preview.tracks.length)
            throw new Error('来源未读取完整，旧默认曲库保持不变。');
        for (const item of preview.tracks) {
            const track = normalizePlatformTrack(item);
            if (!track || track.metadataStatus === 'reference')
                throw new Error('尚未获取完整歌曲信息，不能将来源书签写成正式默认歌曲。');
            if (!seen.has(track.id)) {
                seen.add(track.id);
                tracks.push(track);
            }
        }
    }
    if (tracks.length > 2000) throw new Error('默认曲库超过 2000 首保护上限，旧数据保持不变。');
    return {
        version: (Number.isSafeInteger(previous.version) ? previous.version : 0) + 1,
        title: String(title).trim().slice(0, 80) || '默认曲库',
        tracks,
    };
}
