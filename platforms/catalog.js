export const PLATFORM_NAMES = Object.freeze({
    netease: '网易云音乐',
    qq: 'QQ 音乐',
    kugou: '酷狗音乐',
    kuwo: '酷我音乐',
    migu: '咪咕音乐',
    spotify: 'Spotify',
    youtube: 'YouTube Music',
    apple: 'Apple Music',
    soundcloud: 'SoundCloud',
    audius: 'Audius',
    openverse: 'Openverse',
    direct: '开发者直链',
});
export function webUrl(value) {
    try {
        const url = new URL(value);
        const host = url.hostname.toLowerCase().replace(/\.$/, '');
        if (
            host === 'localhost' ||
            host.endsWith('.localhost') ||
            host.endsWith('.local') ||
            /^(?:0|10|127)\.|^192\.168\.|^169\.254\.|^172\.(?:1[6-9]|2\d|3[01])\.|^\[(?:::|fc|fd|fe80)/i.test(host)
        )
            return null;
        return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password ? url.href : null;
    } catch {
        return null;
    }
}
export const platformTrackKey = (platform, id) => `platform:${platform}:${encodeURIComponent(id)}`;
export function normalizePlatformTrack(raw) {
    if (
        !raw ||
        !Object.hasOwn(PLATFORM_NAMES, raw.platform) ||
        typeof raw.platformTrackId !== 'string' ||
        !raw.platformTrackId.trim() ||
        raw.platformTrackId.length > 300
    )
        return null;
    const sourceUrl = webUrl(raw.sourceUrl);
    if (!sourceUrl) return null;
    const track = {
        id: platformTrackKey(raw.platform, raw.platformTrackId),
        kind: 'platform',
        platform: raw.platform,
        platformTrackId: raw.platformTrackId,
        title: String(raw.title || `${PLATFORM_NAMES[raw.platform]} · ${raw.platformTrackId}`).slice(0, 160),
        artist: String(raw.artist || '').slice(0, 120),
        album: String(raw.album || '').slice(0, 160),
        sourceUrl,
        playback: ['full', 'preview', 'external', 'embed'].includes(raw.playback) ? raw.playback : 'external',
    };
    if (webUrl(raw.cover)) track.cover = webUrl(raw.cover);
    if (Number.isFinite(raw.duration) && raw.duration > 0) track.duration = Math.min(raw.duration, 86400);
    if (raw.metadataStatus === 'reference') track.metadataStatus = 'reference';
    if (['authorization', 'unavailable', 'license'].includes(raw.restriction)) track.restriction = raw.restriction;
    if (raw.platform === 'direct') {
        const url = webUrl(raw.url);
        if (!url || !url.startsWith('https:') || !raw.license?.code || !raw.license?.attribution || !webUrl(raw.license?.url)) return null;
        track.url = url;
    }
    if (raw.license && typeof raw.license.code === 'string')
        track.license = {
            code: raw.license.code.slice(0, 40),
            url: webUrl(raw.license.url) || '',
            attribution: String(raw.license.attribution || '').slice(0, 1000),
            sourceUrl: webUrl(raw.license.sourceUrl) || sourceUrl,
        };
    return track;
}
export function normalizePlaylistSource(source) {
    if (
        !source ||
        !Object.hasOwn(PLATFORM_NAMES, source.platform) ||
        typeof source.id !== 'string' ||
        !source.id ||
        source.id.length > 300 ||
        !webUrl(source.url)
    )
        return null;
    return { platform: source.platform, id: source.id, url: webUrl(source.url),
        ...(source.name ? { name: String(source.name).slice(0, 160) } : {}),
        ...(source.author ? { author: String(source.author).slice(0, 120) } : {}),
        ...(Number.isSafeInteger(source.total) && source.total >= 0 ? { total: source.total } : {}),
        ...(webUrl(source.cover) ? { cover: webUrl(source.cover) } : {}) };
}
export const sourceKey = (source) => (source ? `${source.platform}:${source.id}` : '');
