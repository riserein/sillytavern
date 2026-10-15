import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createMusicRequest } from '../platforms/request.js';
import { createPlatformService } from '../platforms/service.js';
import { officialEmbed } from '../platforms/embeds.js';
import { planImport } from '../platforms/library.js';
import { audiusTrack } from '../platforms/providers.js';
import { buildBuiltinCatalog, approvedDirectTrack } from '../platforms/builtin-maintenance.js';
import {
    normalizeSettings,
    createPlaylist,
    addTrackToPlaylist,
    getQueue,
    bindPlaylistCharacters,
    playlistForCharacter,
} from '../core.js';
const direct = {
    type: 'audio',
    id: 'rain',
    title: '雨声',
    artist: '录音者',
    url: 'https://audio.example.test/rain.mp3',
    permanent: true,
    authorized: true,
    sourceUrl: 'https://example.test/rain',
    license: {
        code: 'CC BY 4.0',
        url: 'https://creativecommons.org/licenses/by/4.0/',
        attribution: '雨声 — 录音者 · CC BY 4.0',
    },
};
const response = (data) => new Response(JSON.stringify(data));

test('fresh requests bypass and invalidate existing cached metadata, not merely suppress new cache writes', async () => {
    let calls = 0;
    const request = createMusicRequest({ fetcher: async () => response({ version: ++calls }) });
    const url = 'https://api.example.test/track';
    assert.equal((await request(url)).version, 1);
    assert.equal((await request(url)).version, 1);
    assert.equal((await request(url, { cacheMs: 0 })).version, 2);
    assert.equal((await request(url)).version, 3);
    await assert.rejects(
        createMusicRequest({
            fetcher: async () => new Response('challenge', { status: 403, headers: { 'cf-mitigated': 'challenge' } }),
        })(url),
        (e) => e.code === 'CHALLENGE',
    );
});

test('official oEmbed metadata is preserved without executing returned HTML or claiming native full playback', async () => {
    const urls = [];
    const service = createPlatformService({
        config: { embeds: { soundcloud: true, spotify: true } },
        request: async (url) => {
            urls.push(url);
            return {
                provider_name: 'SoundCloud',
                title: 'Flickermood',
                author_name: 'Forss',
                thumbnail_url: 'https://example.test/cover.jpg',
                html: '<script>bad()</script>',
            };
        },
    });
    const preview = await service.preview('https://soundcloud.com/forss/flickermood');
    assert.equal(preview.tracks[0].title, 'Flickermood');
    assert.equal(preview.tracks[0].artist, 'Forss');
    assert.equal(preview.tracks[0].html, undefined);
    assert.equal(service.canPlay(preview.tracks[0]), false);
    assert.equal(service.canEmbed(preview.tracks[0]), true);
    assert.equal(new URL(urls[0]).host, 'soundcloud.com');
    await assert.rejects(service.preview('https://soundcloud.com/forss/sets/test'), /没有导入/);
    await assert.rejects(service.resolve(preview.tracks[0]), /未接入站内播放/);
    assert.equal(officialEmbed('https://soundcloud.com.evil.test/forss/song'), null);
    assert.equal(officialEmbed('javascript:alert(1)'), null);
    assert.equal(new URL(officialEmbed('https://open.spotify.com/playlist/ABC').url).pathname, '/embed/playlist/ABC');
    const closed = createPlatformService({
        request: () => {
            throw new Error('不应发请求');
        },
    });
    const bookmark = await closed.preview('https://soundcloud.com/forss/flickermood');
    assert.equal(bookmark.tracks[0].metadataStatus, 'reference');
    assert.equal(closed.canEmbed(preview.tracks[0]), false);
    assert.equal(closed.officialEmbed('https://open.spotify.com/playlist/ABC'), null);
    const old = normalizeSettings({ tracks: bookmark.tracks });
    const snapshot = JSON.stringify(old);
    const plan = planImport(old, preview);
    assert.equal(plan.upgrades.length, 1);
    assert.equal(plan.added.length, 0);
    assert.equal(JSON.stringify(old), snapshot); // Planning never partially edits the user's old library.
});

test('direct default metadata and license survive copy, role binding and a later default deletion', async () => {
    const catalog = await buildBuiltinCatalog({}, [direct, { ...direct, id: 'duplicate' }], {
        previous: { version: 4 },
    });
    assert.equal(catalog.version, 5);
    assert.equal(catalog.tracks.length, 1);
    const settings = normalizeSettings({}, Date.now(), catalog),
        id = catalog.tracks[0].id;
    const list = createPlaylist(settings, '角色雨夜', 'p');
    addTrackToPlaylist(settings, list.id, id);
    bindPlaylistCharacters(settings, list.id, ['Alice.png']);
    const restored = normalizeSettings(JSON.parse(JSON.stringify(settings)), Date.now(), { version: 6, tracks: [] });
    const track = getQueue(restored, 'p')[0];
    assert.equal(track.url, direct.url);
    assert.equal(track.license.attribution, direct.license.attribution);
    assert.equal(playlistForCharacter(restored, 'Alice.png').id, 'p');
    assert.equal((await createPlatformService({ config: {} }).resolve(track)).url, direct.url);
    for (const edit of [
        { authorized: false },
        { permanent: false },
        { url: direct.url + '?token=secret' },
        { license: null },
        { url: 'https://localhost/file.mp3' },
    ])
        assert.throws(() => approvedDirectTrack({ ...direct, ...edit }));
});

test('catalog merges mixed sources but requires explicit acceptance of embedded or metadata-only tracks', async () => {
    const embedded = {
        kind: 'platform',
        platform: 'spotify',
        platformTrackId: 'ABC',
        title: '官方曲目',
        sourceUrl: 'https://open.spotify.com/track/ABC',
        playback: 'embed',
    };
    const service = { preview: async () => ({ complete: true, total: 1, tracks: [embedded] }) };
    await assert.rejects(buildBuiltinCatalog(service, [direct, 'x']), /allow-metadata-only/);
    const previous = await buildBuiltinCatalog({}, [direct]);
    const result = await buildBuiltinCatalog(service, ['x'], { previous, append: true, allowMetadataOnly: true });
    assert.deepEqual(
        result.tracks.map((t) => t.platform),
        ['direct', 'spotify'],
    );
    assert.equal(result.tracks[1].playback, 'embed');
    assert.equal(result.version, previous.version + 1);
});

test('batch CLI produces reviewable metadata, dry run leaves output untouched, failure retains existing output', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'stm-catalog-'));
    try {
        const input = join(dir, 'input.json'),
            out = join(dir, 'builtin.js');
        await writeFile(input, JSON.stringify({ title: '雨夜', sources: [direct] }));
        const run = (extra) =>
            spawnSync(process.execPath, ['scripts/update-builtin.mjs', '--input', input, '--out', out, ...extra], {
                cwd: new URL('..', import.meta.url),
                encoding: 'utf8',
            });
        assert.equal(run([]).status, 0);
        const contents = await readFile(out, 'utf8');
        assert.match(contents, /雨夜/);
        assert.match(contents, /license/);
        assert.equal(run(['--dry-run']).status, 0);
        assert.equal(await readFile(out, 'utf8'), contents);
        await writeFile(
            input,
            JSON.stringify({ sources: [direct, { ...direct, id: 'bad', url: direct.url + '?expires=1' }] }),
        );
        const failed = run([]);
        assert.equal(failed.status, 1);
        assert.match(failed.stderr, /临时地址/);
        assert.equal(await readFile(out, 'utf8'), contents);
    } finally {
        await rm(dir, { recursive: true, force: true });
    }
});

test('source playlist cover, author and original total survive normalizing selected imports', () => {
    const gated = audiusTrack({ id: 'gated', title: '受限曲目', permalink: '/artist/gated', is_stream_gated: true });
    assert.equal(gated.restriction, 'authorization'); assert.equal(gated.playback, 'external');
    const source = {
        platform: 'audius',
        id: 'one',
        url: 'https://audius.co/user/playlist/one',
        cover: 'https://example.test/list.jpg',
        name: '来源',
        author: '作者',
        total: 205,
    };
    const settings = normalizeSettings({ playlists: [{ id: 'p', name: '选中的歌', source, trackIds: [] }] });
    assert.deepEqual(settings.playlists[0].source, source);
});
