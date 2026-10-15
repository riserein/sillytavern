import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseShareLink, extractShareUrl } from '../platforms/links.js';
import { normalizePlatformTrack, platformTrackKey } from '../platforms/catalog.js';
import { createMusicRequest } from '../platforms/request.js';
import { createPlatformService } from '../platforms/service.js';
import { openverseTrack } from '../platforms/providers.js';
import { planImport, findTrack, BUILTIN_ID } from '../platforms/library.js';
import { buildBuiltinCatalog } from '../platforms/builtin-maintenance.js';
import {
    normalizeSettings,
    getQueue,
    createPlaylist,
    addTrackToPlaylist,
    recordPlayback,
    recentTracks,
    bindPlaylistCharacters,
    playlistForCharacter,
} from '../core.js';
const id = '12345678-1234-1234-1234-123456789abc';
const record = (extra = {}) => ({
    id,
    title: '风声',
    creator: '作者',
    url: 'https://media.example.test/full.mp3',
    duration: 90000,
    license: 'by',
    license_version: '4.0',
    license_url: 'https://creativecommons.org/licenses/by/4.0/',
    foreign_landing_url: 'https://example.test/recording',
    ...extra,
});
const platformTrack = (platform = 'openverse', trackId = id) =>
    normalizePlatformTrack({
        platform,
        platformTrackId: trackId,
        title: '风声',
        sourceUrl: `https://openverse.org/audio/${id}/`,
        playback: 'full',
    });
const response = (data, status = 200, headers = {}) => new Response(JSON.stringify(data), { status, headers });

test('canonical songs and playlists are identified for all eleven platforms without hostname spoofing', () => {
    const pairs = [
        ['https://music.163.com/#/song?id=123', 'netease', 'track', '123'],
        ['https://music.163.com/playlist?id=456', 'netease', 'playlist', '456'],
        ['https://y.qq.com/n/ryqq/songDetail/abc123', 'qq', 'track', 'abc123'],
        ['https://y.qq.com/n/yqq/playsquare/456.html', 'qq', 'playlist', '456'],
        ['https://www.kugou.com/song/#hash=ABC123', 'kugou', 'track', 'ABC123'],
        ['https://www.kugou.com/yy/special/single/456.html', 'kugou', 'playlist', '456'],
        ['https://www.kuwo.cn/play_detail/123', 'kuwo', 'track', '123'],
        ['https://www.kuwo.cn/playlist_detail/456', 'kuwo', 'playlist', '456'],
        ['https://music.migu.cn/v3/music/song/ABC', 'migu', 'track', 'ABC'],
        ['https://music.migu.cn/v3/music/playlist/456', 'migu', 'playlist', '456'],
        ['https://open.spotify.com/intl-zh/track/ABC', 'spotify', 'track', 'ABC'],
        ['spotify:playlist:ABC', 'spotify', 'playlist', 'ABC'],
        ['https://music.youtube.com/watch?v=abc&list=xyz', 'youtube', 'track', 'abc'],
        ['https://music.youtube.com/playlist?list=xyz', 'youtube', 'playlist', 'xyz'],
        ['https://music.apple.com/us/album/name/123?i=456', 'apple', 'track', '456'],
        ['https://music.apple.com/us/playlist/name/pl.abc', 'apple', 'playlist', 'pl.abc'],
        ['https://soundcloud.com/user/song', 'soundcloud', 'track', 'user/song'],
        ['https://soundcloud.com/user/sets/collection', 'soundcloud', 'playlist', 'user/sets/collection'],
        ['https://audius.co/user/song', 'audius', 'track', 'user/song'],
        ['https://audius.co/user/playlist/collection', 'audius', 'playlist', 'user/playlist/collection'],
        [`https://openverse.org/audio/${id}/`, 'openverse', 'track', id],
    ];
    for (const [url, platform, type, key] of pairs) {
        const parsed = parseShareLink(`分享一首歌曲「测试」 ${url}。`);
        assert.deepEqual([parsed.platform, parsed.type, parsed.id], [platform, type, key]);
    }
    assert.throws(() => parseShareLink('https://music.163.com.evil.test/song?id=1'));
    assert.throws(() => parseShareLink('https://user:pass@music.163.com/song?id=1'));
    assert.throws(() => parseShareLink('https://on.soundcloud.com/unknown'));
    assert.throws(() => extractShareUrl('javascript:alert(1)'));
});

test('platform keys, untrusted media URLs, duration and public licenses normalize independently', () => {
    assert.notEqual(platformTrackKey('qq', '123'), platformTrackKey('netease', '123'));
    assert.equal(
        normalizePlatformTrack({ platform: 'missing', platformTrackId: '123', sourceUrl: 'https://example.test' }),
        null,
    );
    assert.equal(
        normalizePlatformTrack({ platform: 'qq', platformTrackId: '123', sourceUrl: 'javascript:alert(1)' }),
        null,
    );
    const track = openverseTrack(record());
    assert.equal(track.duration, 90);
    assert.equal(track.playback, 'full');
    assert.equal(track.license.code, 'by');
    assert.equal(openverseTrack(record({ license: 'unknown' })).playback, 'external');
    assert.equal(openverseTrack(record({ url: 'javascript:alert(1)' })).playback, 'external');
    assert.equal(openverseTrack(record({ license: 'by-nc' })).playback, 'external');
    assert.equal(openverseTrack(record({ license_url: null })).playback, 'external');
});

test('legacy files, settings, memberships and role bindings survive platform-track normalization', () => {
    const local = { id: 'old-blob', title: '旧音乐', kind: 'local' };
    const online = platformTrack();
    const settings = normalizeSettings({
        tracks: [local, online, online],
        playlists: [{ id: 'p', name: '混合', trackIds: ['old-blob', online.id], characterAvatars: ['Alice.png'] }],
        activePlaylistId: 'p',
        currentId: 'old-blob',
    });
    assert.deepEqual(settings.tracks[0], local);
    assert.equal(settings.tracks.length, 2);
    assert.deepEqual(
        getQueue(settings).map((t) => t.kind),
        ['local', 'platform'],
    );
    assert.equal(playlistForCharacter(settings, 'Alice.png').id, 'p');
    assert.equal(settings.currentId, 'old-blob');
    assert.equal(JSON.parse(JSON.stringify(settings)).builtinCatalog, undefined);
});

test('builtin catalog upgrades stay separate, retain hidden state and keep user playlist copies unchanged', () => {
    const original = platformTrack();
    const first = normalizeSettings({ builtinHidden: true }, Date.now(), {
        version: 1,
        title: '预设',
        tracks: [original],
    });
    assert.equal(first.playlists.length, 0);
    assert.equal(first.tracks.length, 0);
    assert.equal(getQueue(first, BUILTIN_ID).length, 1);
    const list = createPlaylist(first, '收藏', 'own');
    addTrackToPlaylist(first, list.id, original.id);
    first.tracks[0].title = '自己的名字';
    recordPlayback(first, original.id);
    bindPlaylistCharacters(first, list.id, ['Alice.png']);
    const upgraded = normalizeSettings(JSON.parse(JSON.stringify(first)), Date.now(), {
        version: 2,
        title: '预设',
        tracks: [
            { ...original, title: '开发者新名字' },
            platformTrack('openverse', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'),
        ],
    });
    assert.equal(upgraded.builtinHidden, true);
    assert.equal(upgraded.playlists.length, 1);
    assert.equal(upgraded.builtinCatalog.version, 2);
    assert.equal(upgraded.builtinCatalog.tracks.length, 2);
    assert.equal(findTrack(upgraded, original.id).title, '自己的名字');
    assert.equal(recentTracks(upgraded)[0].track.title, '自己的名字');
    assert.equal(playlistForCharacter(upgraded, 'Alice.png').id, 'own');
    const removed = normalizeSettings(JSON.parse(JSON.stringify(upgraded)), Date.now(), { version: 3, tracks: [] });
    assert.equal(getQueue(removed, 'own')[0].title, '自己的名字');
});

test('import planning deduplicates and refuses incomplete or overflowing playlists before any mutation', () => {
    const track = platformTrack();
    const settings = normalizeSettings({ tracks: [track] });
    const source = { platform: 'audius', id: 'p', url: 'https://audius.co/user/playlist/test' };
    const preview = { name: '来源歌单', tracks: [track, track], total: 2, complete: true, source };
    const plan = planImport(settings, preview, { newPlaylist: true });
    assert.equal(plan.added.length, 0);
    assert.equal(plan.newPlaylist, true);
    const list = createPlaylist(settings, '来源歌单', 'existing');
    list.source = source;
    assert.equal(planImport(settings, preview, { newPlaylist: true }).targetId, 'existing');
    const snapshot = JSON.stringify(settings);
    assert.throws(() => planImport(settings, { ...preview, total: 200 }, { newPlaylist: true }), /完整/);
    assert.equal(JSON.stringify(settings), snapshot);
    settings.tracks = Array.from({ length: 200 }, (_, n) => ({ id: String(n), kind: 'local', title: String(n) }));
    const full = JSON.stringify(settings);
    assert.throws(() => planImport(settings, { ...preview, tracks: [track], total: 1 }), /200/);
    assert.equal(JSON.stringify(settings), full);
});

test('music requests cache, handle malformed responses and impose a shared 429 cooldown without retry loops', async () => {
    let calls = 0,
        time = 1000;
    const request = createMusicRequest({
        now: () => time,
        fetcher: async () => {
            calls++;
            return response({ ok: true });
        },
    });
    await request('https://api.example.test/search');
    await request('https://api.example.test/search');
    assert.equal(calls, 1);
    time += 130000;
    await request('https://api.example.test/search');
    assert.equal(calls, 2);
    let limitedCalls = 0;
    const limited = createMusicRequest({
        now: () => time,
        fetcher: async () => {
            limitedCalls++;
            return response({}, 429, { 'Retry-After': '60' });
        },
    });
    await assert.rejects(limited('https://api.example.test/a'), (e) => e.code === 'RATE_LIMIT');
    await assert.rejects(limited('https://api.example.test/b'), (e) => e.code === 'RATE_LIMIT');
    assert.equal(limitedCalls, 1);
    await assert.rejects(
        createMusicRequest({ fetcher: async () => new Response('<html>bad</html>') })('https://api.example.test'),
        (e) => e.code === 'RESPONSE',
    );
});

test('music request abort and timeout are distinct and never create extra requests', async () => {
    const waiting = (_url, { signal }) =>
        new Promise((_resolve, reject) =>
            signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError'))),
        );
    const controller = new AbortController();
    const pending = createMusicRequest({ fetcher: waiting })('https://api.example.test', { signal: controller.signal });
    controller.abort();
    await assert.rejects(pending, (e) => e.name === 'AbortError');
    await assert.rejects(
        createMusicRequest({ fetcher: waiting, timeout: 5 })('https://api.example.test'),
        (e) => e.code === 'TIMEOUT',
    );
});

test('multi-source search retains successful results when another provider fails, and memoized streams avoid extra metadata quota', async () => {
    const calls = [];
    const request = async (url) => {
        calls.push(url);
        if (new URL(url).host === 'audius.example.test') throw new Error('上游失败');
        return { results: [record(), record()], next: null };
    };
    const service = createPlatformService({
        request,
        config: {
            openverse: { enabled: true, baseUrl: 'https://openverse.example.test/v1/' },
            audius: { apiKey: 'public-key', baseUrl: 'https://audius.example.test/v1/' },
        },
    });
    const result = await service.search('piano');
    assert.equal(result.tracks.length, 1);
    assert.equal(result.errors.length, 1);
    assert.equal(result.errors[0].platform, 'audius');
    const stream = await service.resolve(result.tracks[0]);
    assert.equal(stream.url, 'https://media.example.test/full.mp3');
    assert.equal(calls.length, 2);
    assert.equal(service.platforms().find((p) => p.id === 'spotify').capabilities.search, false);
});

test('playlist pagination preserves 205 songs and refuses repeated/incomplete pages; unsupported lists never become empty successes', async () => {
    const tracks = Array.from({ length: 205 }, (_, n) => ({
        id: `id${n}`,
        title: `歌${n}`,
        duration: 60,
        user: { handle: 'artist', name: '歌手' },
        permalink: `/artist/song${n}`,
    }));
    let bad = false;
    const request = async (url) => {
        const parsed = new URL(url);
        if (parsed.pathname.endsWith('/resolve'))
            return { data: [{ id: 'playlist', playlist_name: '大歌单', track_count: 205 }] };
        const offset = Number(parsed.searchParams.get('offset'));
        return { data: tracks.slice(bad ? 0 : offset, (bad ? 0 : offset) + 100) };
    };
    const service = createPlatformService({
        request,
        config: { audius: { apiKey: 'public-key', baseUrl: 'https://audius.example.test/v1/' } },
    });
    const result = await service.preview('https://audius.co/user/playlist/test');
    assert.equal(result.total, 205);
    assert.equal(result.tracks[204].title, '歌204');
    bad = true;
    await assert.rejects(service.preview('https://audius.co/user/playlist/test'), /分页重复/);
    await assert.rejects(service.preview('https://open.spotify.com/playlist/ABC'), /没有导入/);
    const reference = await service.preview('https://open.spotify.com/track/ABC');
    assert.equal(reference.tracks[0].metadataStatus, 'reference');
    assert.equal(reference.tracks[0].playback, 'external');
    assert.equal(service.canPlay(reference.tracks[0]), false);
});

test('developer catalog generation is metadata-only, ordered, deduplicated and rejects bookmarks or incomplete sources', async () => {
    const track = platformTrack();
    const service = { preview: async () => ({ complete: true, total: 2, tracks: [track, track] }) };
    const result = await buildBuiltinCatalog(service, ['https://example.test/song'], { previous: { version: 5 } });
    assert.equal(result.version, 6);
    assert.equal(result.tracks.length, 1);
    assert.equal(result.tracks[0].streamUrl, undefined);
    await assert.rejects(
        buildBuiltinCatalog({ preview: async () => ({ complete: false, total: 20, tracks: [track] }) }, ['x']),
        /完整/,
    );
    await assert.rejects(
        buildBuiltinCatalog(
            {
                preview: async () => ({
                    complete: true,
                    total: 1,
                    tracks: [{ ...track, metadataStatus: 'reference' }],
                }),
            },
            ['x'],
        ),
        /书签/,
    );
});
