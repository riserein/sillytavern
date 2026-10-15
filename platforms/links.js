import { PLATFORM_NAMES, normalizePlatformTrack } from './catalog.js';
export function extractShareUrl(text) {
    const value = String(text).trim().replace(/&amp;/g, '&');
    const spotify = value.match(/(?:^|\s)spotify:(track|playlist):([a-zA-Z0-9]+)/);
    if (spotify) return `https://open.spotify.com/${spotify[1]}/${spotify[2]}`;
    const found = value.match(/https?:\/\/[^\s<>"“”「」『』]+/i)?.[0]?.replace(/[，。；、！!？?）)\]】》]+$/g, '');
    if (!found) throw new Error('请粘贴包含完整 HTTP / HTTPS 链接的分享文本。');
    const url = new URL(found);
    if (url.username || url.password || url.port) throw new Error('分享链接不能包含账号密码或自定义端口。');
    return url.href;
}
export function parseShareLink(text) {
    const extracted = extractShareUrl(text);
    const url = typeof extracted === 'string' ? new URL(extracted) : extracted;
    const host = url.hostname.toLowerCase();
    const path = decodeURI(url.pathname);
    const query = url.searchParams;
    let platform, type, id;
    const result = () => {
        if (!id || !type)
            throw new Error(
                `已识别${PLATFORM_NAMES[platform]}，但无法从此链接确定歌曲或歌单。请在官方页面复制完整的歌曲/歌单网址，短链接需先打开。`,
            );
        return { platform, type, id, url: url.href };
    };
    if (['music.163.com', 'y.music.163.com', '163cn.tv'].includes(host)) {
        platform = 'netease';
        const route = url.hash.startsWith('#/') ? new URL(url.hash.slice(1), url.origin) : url;
        const match = route.pathname.match(/\/(song|playlist)(?:\/|$)/);
        type = match?.[1] === 'song' ? 'track' : match?.[1];
        id = route.searchParams.get('id');
    } else if (['y.qq.com', 'c.y.qq.com', 'i.y.qq.com'].includes(host)) {
        platform = 'qq';
        const track = path.match(/\/(?:song|songDetail)\/([\w]+)(?:\.html)?/i);
        const list = path.match(/\/(?:playlist|playsquare)\/([\w]+)/i);
        if (track) {
            type = 'track';
            id = track[1];
        } else if (list) {
            type = 'playlist';
            id = list[1];
        } else if (query.get('songmid')) {
            type = 'track';
            id = query.get('songmid');
        } else if (query.get('disstid') || query.get('dissid')) {
            type = 'playlist';
            id = query.get('disstid') || query.get('dissid');
        }
    } else if (['www.kugou.com', 'm.kugou.com', 'kugou.com', 'www.kugou.com.cn', 't.kugou.com'].includes(host)) {
        platform = 'kugou';
        const hash = new URLSearchParams(url.hash.slice(1)).get('hash') || query.get('hash');
        const song = path.match(/\/song\/([\w]+)(?:\.html)?/);
        const list = path.match(/\/special\/single\/(\d+)/);
        if (hash || song) {
            type = 'track';
            id = hash || song[1];
        } else if (list || query.get('specialid')) {
            type = 'playlist';
            id = list?.[1] || query.get('specialid');
        }
    } else if (['www.kuwo.cn', 'kuwo.cn', 'm.kuwo.cn'].includes(host)) {
        platform = 'kuwo';
        const match = path.match(/\/(play_detail|playlist_detail)\/(\d+)/);
        type = match?.[1] === 'play_detail' ? 'track' : match ? 'playlist' : null;
        id = match?.[2];
    } else if (['music.migu.cn', 'm.music.migu.cn', 'h5.nf.migu.cn'].includes(host)) {
        platform = 'migu';
        const match = path.match(/\/(song|playlist)\/([\w]+)/);
        type = match?.[1] === 'song' ? 'track' : match?.[1];
        id = match?.[2];
    } else if (host === 'open.spotify.com') {
        platform = 'spotify';
        const match = path.match(/\/(track|playlist)\/([a-zA-Z0-9]+)/);
        type = match?.[1] === 'track' ? 'track' : match?.[1];
        id = match?.[2];
    } else if (['music.youtube.com', 'www.youtube.com', 'youtube.com', 'youtu.be'].includes(host)) {
        platform = 'youtube';
        id = host === 'youtu.be' ? path.split('/')[1] : query.get('v');
        type = id ? 'track' : query.get('list') ? 'playlist' : null;
        id ||= query.get('list');
    } else if (host === 'music.apple.com') {
        platform = 'apple';
        const playlist = path.match(/\/playlist\/(?:[^/]+\/)?(pl\.[\w-]+)/);
        const song = path.match(/\/song\/(?:[^/]+\/)?(\d+)/);
        if (playlist) {
            type = 'playlist';
            id = playlist[1];
        } else if (query.get('i') || song) {
            type = 'track';
            id = query.get('i') || song[1];
        }
    } else if (['soundcloud.com', 'www.soundcloud.com', 'on.soundcloud.com'].includes(host)) {
        platform = 'soundcloud';
        const parts = path.split('/').filter(Boolean);
        if (host !== 'on.soundcloud.com' && parts.length >= 2) {
            type = parts[1] === 'sets' && parts[2] ? 'playlist' : parts.length === 2 ? 'track' : null;
            id = parts.join('/');
        }
    } else if (['audius.co', 'www.audius.co'].includes(host)) {
        platform = 'audius';
        const parts = path.split('/').filter(Boolean);
        if (parts.length >= 2) {
            type = ['playlist', 'album'].includes(parts[1]) ? 'playlist' : 'track';
            id = parts.join('/');
        }
    } else if (['openverse.org', 'www.openverse.org', 'api.openverse.org'].includes(host)) {
        platform = 'openverse';
        const match = path.match(/\/audio\/([a-f\d-]{36})(?:\/|$)/i);
        type = match ? 'track' : null;
        id = match?.[1];
    } else throw new Error('暂不识别这个分享网站。音频文件直链请使用“本地与直链”入口。');
    return result();
}
export function referenceTrack(link) {
    return normalizePlatformTrack({
        platform: link.platform,
        platformTrackId: link.id,
        sourceUrl: link.url,
        playback: 'external',
        metadataStatus: 'reference',
    });
}
