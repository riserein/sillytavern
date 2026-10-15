import { normalizePlatformTrack, webUrl } from './catalog.js';
import { MusicRequestError } from './request.js';
const OPEN_LICENSES = new Set(['by', 'by-sa', 'cc0', 'pdm']);
export function openverseTrack(raw) {
    const license = String(raw?.license || '').toLowerCase();
    const streamUrl = webUrl(raw?.url);
    const licenseUrl = webUrl(raw?.license_url);
    const track = normalizePlatformTrack({
        platform: 'openverse',
        platformTrackId: String(raw?.id || ''),
        title: raw?.title,
        artist: raw?.creator,
        cover: raw?.thumbnail,
        duration: Number(raw?.duration) / 1000,
        sourceUrl: `https://openverse.org/audio/${raw?.id}/`,
        playback: streamUrl && licenseUrl && OPEN_LICENSES.has(license) ? 'full' : 'external',
        restriction: streamUrl && licenseUrl && OPEN_LICENSES.has(license) ? undefined : 'license',
        license: {
            code: license || '未明确',
            url: licenseUrl,
            sourceUrl: raw?.foreign_landing_url,
            attribution: `${raw?.title || '未命名音频'} — ${raw?.creator || '作者未注明'} · ${license.toUpperCase()} ${raw?.license_version || ''}`,
        },
    });
    return track ? { ...track, streamUrl } : null;
}
export function audiusTrack(raw) {
    const gated = raw?.is_stream_gated || raw?.stream_conditions || raw?.access?.stream === false;
    return normalizePlatformTrack({
        platform: 'audius',
        platformTrackId: String(raw?.id || ''),
        title: raw?.title,
        artist: raw?.user?.name,
        cover: raw?.artwork?.['480x480'] || raw?.artwork?.['150x150'],
        duration: raw?.duration,
        sourceUrl: raw?.permalink
            ? new URL(raw.permalink, 'https://audius.co').href
            : `https://audius.co/${raw?.user?.handle || ''}/${raw?.id || ''}`,
        playback: raw?.is_streamable === false || gated ? 'external' : 'full',
        restriction: gated ? 'authorization' : raw?.is_streamable === false ? 'unavailable' : undefined,
    });
}
export function createProviders(request, config) {
    const providers = new Map();
    providers.set('direct', {
        capabilities: { search: false, importTrack: false, importPlaylist: false, playback: true },
        async resolve(track) {
            const valid = normalizePlatformTrack(track);
            if (!valid?.url || valid.playback !== 'full') throw new MusicRequestError('开发者预设音频信息不完整，请更新插件或联系维护者。', 'RIGHTS');
            return { url: valid.url, track: valid };
        },
    });
    for (const platform of ['soundcloud', 'spotify']) {
        if (!config.embeds?.[platform]) continue;
        providers.set(platform, {
            capabilities: { search: false, importTrack: true, importPlaylist: false, playback: false, embed: true },
            async importTrack(link, { signal } = {}) {
                const url = new URL(platform === 'spotify' ? 'https://open.spotify.com/oembed' : 'https://soundcloud.com/oembed');
                url.search = new URLSearchParams({ url: link.url, format: 'json' });
                const metadata = await request(url.href, { signal });
                if (!metadata.title || metadata.provider_name?.toLowerCase() !== platform) throw new MusicRequestError('未读取到官方歌曲信息，未保存。', 'RESPONSE');
                return normalizePlatformTrack({ platform, platformTrackId: link.id, title: metadata.title,
                    artist: metadata.author_name, cover: metadata.thumbnail_url, sourceUrl: link.url, playback: 'embed' });
            },
        });
    }
    if (config.openverse?.enabled) {
        const base = config.openverse.baseUrl;
        const memo = new Map(),
            invalid = new Set();
        const remember = (track) => {
            if (track) {
                memo.set(track.platformTrackId, { track, until: Date.now() + 600000 });
                if (memo.size > 500) memo.delete(memo.keys().next().value);
            }
            return track;
        };
        providers.set('openverse', {
            capabilities: { search: true, importTrack: true, importPlaylist: false, playback: true },
            async search(query, { signal, page = 1 } = {}) {
                const url = new URL('audio/', base);
                url.search = new URLSearchParams({
                    q: query,
                    page: String(page),
                    page_size: '20',
                    license: 'cc0,by,by-sa,pdm',
                });
                const body = await request(url.href, { signal });
                if (!Array.isArray(body.results)) throw new MusicRequestError('Openverse 返回格式已变化。', 'RESPONSE');
                return {
                    tracks: body.results.map((raw) => remember(openverseTrack(raw))).filter(Boolean),
                    nextPage: body.next ? page + 1 : null,
                };
            },
            async getTrack(id, { signal, fresh = false } = {}) {
                if (!/^[a-f\d-]{36}$/i.test(id)) throw new MusicRequestError('Openverse 音频标识无效。', 'RESPONSE');
                const invalidated = invalid.delete(id), force = fresh || invalidated;
                const cached = memo.get(id);
                if (!force && cached?.until > Date.now()) return cached.track;
                return remember(
                    openverseTrack(
                        await request(new URL(`audio/${id}/`, base).href, { signal, cacheMs: force ? 0 : 120000 }),
                    ),
                );
            },
            async importTrack(link, options) {
                return this.getTrack(link.id, options);
            },
            invalidate(track) {
                memo.delete(track.platformTrackId);
                invalid.add(track.platformTrackId);
            },
            async resolve(track, options) {
                const fresh = await this.getTrack(track.platformTrackId, options);
                if (!fresh || fresh.playback !== 'full' || !fresh.streamUrl)
                    throw new MusicRequestError('这个音频没有可确认的公开许可或可播放地址，请前往来源查看。', 'RIGHTS');
                return { url: fresh.streamUrl, track: fresh };
            },
        });
    }
    if (config.audius?.apiKey) {
        const api = async (path, { signal, fresh = false, ...params } = {}) => {
            const url = new URL(path, config.audius.baseUrl);
            url.search = new URLSearchParams({ ...params, api_key: config.audius.apiKey });
            return request(url.href, { signal, cacheMs: fresh ? 0 : 120000 });
        };
        providers.set('audius', {
            capabilities: { search: true, importTrack: true, importPlaylist: true, playback: true },
            async search(query, { signal, page = 1 } = {}) {
                const result = await api('tracks/search', {
                    signal,
                    query,
                    limit: '20',
                    offset: String((page - 1) * 20),
                });
                if (!Array.isArray(result.data)) throw new MusicRequestError('Audius 返回格式已变化。', 'RESPONSE');
                return {
                    tracks: result.data.map(audiusTrack).filter(Boolean),
                    nextPage: result.data.length === 20 ? page + 1 : null,
                };
            },
            async importTrack(link, { signal } = {}) {
                const result = await api('resolve', { signal, url: link.url });
                const item = Array.isArray(result.data) ? result.data[0] : result.data;
                const track = audiusTrack(item);
                if (!track) throw new MusicRequestError('无法读取 Audius 歌曲信息。', 'RESPONSE');
                return track;
            },
            async importPlaylist(link, { signal, onProgress } = {}) {
                const resolved = await api('resolve', { signal, url: link.url });
                const list = Array.isArray(resolved.data) ? resolved.data[0] : resolved.data;
                if (!list?.id) throw new MusicRequestError('无法读取 Audius 歌单。', 'RESPONSE');
                const tracks = [];
                const seenPages = new Set();
                let complete = false;
                const declared = Array.isArray(list.playlist_contents)
                    ? list.playlist_contents.length
                    : Number(list.track_count ?? list.total_track_count);
                for (let offset = 0; offset < 2000; offset += 100) {
                    const result = await api(`playlists/${encodeURIComponent(list.id)}/tracks`, {
                        signal,
                        limit: '100',
                        offset: String(offset),
                    });
                    if (!Array.isArray(result.data))
                        throw new MusicRequestError('Audius 歌单数据格式已变化。', 'RESPONSE');
                    const fingerprint = JSON.stringify(result.data.map((raw) => raw.id));
                    if (result.data.length && seenPages.has(fingerprint))
                        throw new MusicRequestError('歌单分页重复，无法确认是否读取完整，本次不会导入。', 'INCOMPLETE');
                    seenPages.add(fingerprint);
                    const pageTracks = result.data.map(audiusTrack);
                    if (pageTracks.some((track) => !track))
                        throw new MusicRequestError('歌单包含无法识别的歌曲，本次不会导入。', 'INCOMPLETE');
                    tracks.push(...pageTracks);
                    onProgress?.(tracks.length);
                    if (tracks.length > 2000) throw new MusicRequestError('歌单超过 2000 首读取保护上限，未导入。', 'INCOMPLETE');
                    if (result.data.length < 100 || (Number.isFinite(declared) && tracks.length >= declared)) {
                        complete = true;
                        break;
                    }
                }
                if (!complete || (Number.isFinite(declared) && tracks.length !== declared))
                    throw new MusicRequestError(
                        `歌单未读取完整（已读 ${tracks.length}${Number.isFinite(declared) ? ` / ${declared}` : ''} 首），本次不会导入。`,
                        'INCOMPLETE',
                    );
                return {
                    name: list.playlist_name || 'Audius 歌单',
                    cover: webUrl(list.artwork?.['480x480']),
                    tracks,
                    total: tracks.length,
                    source: { platform: 'audius', id: String(list.id), url: link.url,
                        name: list.playlist_name, author: list.user?.name, cover: webUrl(list.artwork?.['480x480']) },
                };
            },
            async resolve(track, { signal } = {}) {
                const result = await api(`tracks/${encodeURIComponent(track.platformTrackId)}`, {
                    signal,
                    fresh: true,
                });
                const fresh = audiusTrack(result.data);
                if (!fresh || fresh.playback !== 'full')
                    throw new MusicRequestError('这首歌需要账号授权或暂不允许站内播放。', 'RIGHTS');
                const url = new URL(
                    `tracks/${encodeURIComponent(track.platformTrackId)}/stream`,
                    config.audius.baseUrl,
                );
                url.searchParams.set('api_key', config.audius.apiKey);
                return { url: url.href, track: fresh };
            },
        });
    }
    return providers;
}
