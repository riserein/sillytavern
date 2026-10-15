import { normalizePlatformTrack, webUrl } from './catalog.js';

export function approvedDirectTrack(source) {
    if (!source || source.type !== 'audio' || !/^[a-zA-Z0-9_-]{1,80}$/.test(source.id || ''))
        throw new Error('直链曲目需要固定 id（英文、数字、下划线或短横线，最多 80 字符）。');
    const url = webUrl(source.url);
    if (
        !url ||
        !url.startsWith('https:') ||
        !/\.(mp3|wav|ogg|oga|m4a|aac|flac|opus|webm)$/i.test(new URL(url).pathname)
    )
        throw new Error('默认直链须为公开 HTTPS 音频文件地址，不能使用分享网页。');
    if (new URL(url).search || new URL(url).hash)
        throw new Error('默认直链不得包含查询参数或片段，以免保存带签名的临时地址。请提供固定公开地址。');
    if (source.permanent !== true || source.authorized !== true)
        throw new Error('请确认直链长期公开有效（permanent）并已取得分发和播放授权（authorized）。');
    if (
        !String(source.title || '').trim() ||
        !String(source.artist || '').trim() ||
        !source.license?.attribution ||
        !webUrl(source.license?.url) ||
        !source.license?.code
    )
        throw new Error('直链需要歌名、作者、许可/授权名称、证明链接和署名文字。');
    const track = normalizePlatformTrack({
        ...source,
        platform: 'direct',
        platformTrackId: source.id,
        sourceUrl: source.sourceUrl || url,
        url,
        playback: 'full',
    });
    if (!track) throw new Error('直链曲目元数据无效，未生成默认曲库。');
    return track;
}

export async function buildBuiltinCatalog(
    service,
    sources,
    { title = '默认曲库', previous = { version: 0 }, append = false, allowMetadataOnly = false } = {},
) {
    if (!sources.length) throw new Error('至少提供一个正式歌曲或歌单链接。');
    const tracks = [],
        seen = new Set(),
        directUrls = new Set();
    const add = (item) => {
        const track = normalizePlatformTrack(item);
        if (!track || track.metadataStatus === 'reference')
            throw new Error('尚未获取完整歌曲信息，不能将来源书签写成正式默认歌曲。');
        if (track.playback !== 'full' && !allowMetadataOnly)
            throw new Error(
                `「${track.title}」不能直接完整播放。若明确接受仅元数据或官方播放器条目，请显式使用 --allow-metadata-only。`,
            );
        if (seen.has(track.id)) return;
        if (track.platform === 'direct' && directUrls.has(track.url)) return;
        seen.add(track.id);
        if (track.platform === 'direct') directUrls.add(track.url);
        tracks.push(track);
    };
    if (append) for (const item of previous.tracks || []) add(item);
    for (const source of sources) {
        if (source?.type === 'audio') {
            add(approvedDirectTrack(source));
            continue;
        }
        const link = typeof source === 'string' ? source : source?.type === 'share' ? source.url : null;
        if (!link) throw new Error('每项应为分享链接，或 type 为 audio / share 的对象。');
        const preview = await service.preview(link);
        if (!preview.complete || preview.total !== preview.tracks.length)
            throw new Error('来源未读取完整，旧默认曲库保持不变。');
        for (const item of preview.tracks) {
            add(item);
        }
    }
    if (tracks.length > 2000) throw new Error('默认曲库超过 2000 首保护上限，旧数据保持不变。');
    return {
        version: (Number.isSafeInteger(previous.version) ? previous.version : 0) + 1,
        title: String(title).trim().slice(0, 80) || '默认曲库',
        tracks,
    };
}
