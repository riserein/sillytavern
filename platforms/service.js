import { PLATFORM_NAMES, normalizePlatformTrack } from './catalog.js';
import { PLATFORM_CONFIG } from './config.js';
import { parseShareLink, referenceTrack } from './links.js';
import { createMusicRequest, MusicRequestError } from './request.js';
import { createProviders } from './providers.js';
import { officialEmbed } from './embeds.js';
export function createPlatformService({ config = PLATFORM_CONFIG, request = createMusicRequest() } = {}) {
    const providers = createProviders(request, config);
    return {
        platforms: () =>
            Object.entries(PLATFORM_NAMES).filter(([id]) => id !== 'direct').map(([id, name]) => ({
                id,
                name,
                capabilities: providers.get(id)?.capabilities || {
                    search: false,
                    importTrack: false,
                    importPlaylist: false,
                    playback: false,
                },
            })),
        canPlay: (track) =>
            Boolean(
                track &&
                    (track.kind !== 'platform' ||
                        (providers.get(track.platform)?.capabilities.playback && track.playback === 'full')),
            ),
        canEmbed: (track) => Boolean(providers.get(track?.platform)?.capabilities.embed && track?.playback === 'embed' && officialEmbed(track)),
        officialEmbed: (value) => {
            const resource = officialEmbed(value);
            return resource && config.embeds?.[resource.platform] ? resource : null;
        },
        async search(query, { platform = 'all', signal, pages = {} } = {}) {
            query = String(query).trim();
            if (!query || query.length > 160) throw new MusicRequestError('请输入 1 至 160 个字符的关键词。', 'INPUT');
            const selected = [...providers].filter(
                ([id, p]) =>
                    p.capabilities.search &&
                    (platform === 'all' || id === platform) &&
                    (!Object.keys(pages).length || id in pages),
            );
            if (!selected.length) throw new MusicRequestError('这个平台当前没有可用的搜索服务。', 'UNSUPPORTED');
            const results = await Promise.allSettled(
                selected.map(async ([id, p]) => ({ id, ...(await p.search(query, { signal, page: pages[id] || 1 })) })),
            );
            if (signal?.aborted) throw new DOMException('已取消搜索。', 'AbortError');
            const tracks = [],
                errors = [],
                nextPages = {};
            const seen = new Set();
            results.forEach((result, index) => {
                if (result.status === 'rejected') {
                    errors.push({ platform: selected[index][0], message: result.reason.message });
                    return;
                }
                for (const raw of result.value.tracks) {
                    const track = normalizePlatformTrack(raw);
                    if (track && !seen.has(track.id)) {
                        tracks.push(track);
                        seen.add(track.id);
                    }
                }
                if (result.value.nextPage) nextPages[result.value.id] = result.value.nextPage;
            });
            return { tracks, errors, nextPages };
        },
        async preview(text, { signal, onProgress } = {}) {
            const link = parseShareLink(text);
            const provider = providers.get(link.platform);
            if (link.type === 'playlist') {
                if (!provider?.capabilities.importPlaylist)
                    throw new MusicRequestError(
                        `已识别${PLATFORM_NAMES[link.platform]}歌单，但当前未接入可读取它的服务。本次没有导入歌曲，请前往官方平台查看。`,
                        'UNSUPPORTED',
                    );
                const result = await provider.importPlaylist(link, { signal, onProgress });
                return {
                    ...result,
                    platform: link.platform,
                    type: 'playlist',
                    complete: true,
                    tracks: result.tracks.map(normalizePlatformTrack).filter(Boolean),
                };
            }
            const track = provider?.capabilities.importTrack
                ? await provider.importTrack(link, { signal })
                : referenceTrack(link);
            if (!track) throw new MusicRequestError('未获得有效的歌曲信息，本次不会导入。', 'RESPONSE');
            return {
                type: 'track',
                name: track.title,
                platform: link.platform,
                tracks: [track],
                total: 1,
                complete: true,
                source: { platform: link.platform, id: link.id, url: link.url },
                warning:
                    track.metadataStatus === 'reference'
                        ? '当前只能保存来源链接，尚未读取歌曲名称、封面和音频；添加后需前往官方平台收听。'
                        : track.playback === 'embed' ? '已读取官方歌曲信息，可在插件内打开官方播放器。完整收听或试听由平台和账号决定；不作为本插件直接音源，不接入本插件的播放统计。' : '',
            };
        },
        invalidate(track) {
            providers.get(track?.platform)?.invalidate?.(track);
        },
        async resolve(track, { signal } = {}) {
            const provider = providers.get(track.platform);
            if (!provider?.capabilities.playback)
                throw new MusicRequestError('当前平台尚未接入站内播放，请前往官方平台收听。', 'UNSUPPORTED');
            return provider.resolve(track, { signal });
        },
    };
}
