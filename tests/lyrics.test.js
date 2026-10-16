import test from 'node:test';
import assert from 'node:assert/strict';
import { searchLyrics } from '../lyrics.js';
import { normalizeSettings } from '../core.js';
import { buildCardExports, attachPlayerToCard, prepareCardPackage } from '../card-player/export.js';
import { verifyCardObject, readScriptPayload } from '../card-player/quality.js';
const fixtures = [
    {
        id: 1,
        trackName: 'Demo',
        artistName: 'A',
        duration: 120,
        syncedLyrics: '[00:01]test',
        plainLyrics: 'test',
    },
    {
        id: 2,
        trackName: 'Demo',
        artistName: 'Other',
        duration: 130,
        plainLyrics: 'other recording',
    },
    { id: 1, trackName: 'duplicate', plainLyrics: 'duplicate' },
    { id: 3, trackName: 'instrumental', instrumental: true },
    { id: 4, trackName: 'huge', plainLyrics: 'x'.repeat(50001) },
];
test('official lyric search normalizes, ranks and deduplicates candidates without silently choosing another recording', async () => {
    let requested;
    const rows = await searchLyrics(
        { title: 'Demo', artist: 'A', duration: 120 },
        {
            fetcher: async (url, options) => {
                requested = { url, options };
                return Response.json(fixtures);
            },
        },
    );
    assert.equal(new URL(requested.url).origin, 'https://lrclib.net');
    assert.equal(new URL(requested.url).searchParams.get('artist_name'), 'A');
    assert.equal(requested.options.credentials, 'omit');
    assert.equal(rows.length, 2);
    assert.equal(rows[0].id, 1);
    assert.equal(rows[0].synced, true);
    assert.equal(rows[0].source, 'https://lrclib.net/api/get/1');
    assert.equal(rows[1].lyrics, 'other recording');
});
test('lyric search distinguishes empty results, rate limits, malformed responses, connection failures and cancellation', async () => {
    const query = { title: 'Demo' };
    assert.deepEqual(await searchLyrics(query, { fetcher: async () => Response.json([]) }), []);
    await assert.rejects(
        searchLyrics(query, {
            fetcher: async () => new Response('', { status: 429 }),
        }),
        /繁忙/,
    );
    await assert.rejects(
        searchLyrics(query, {
            fetcher: async () => new Response('<html>not JSON</html>'),
        }),
        /有效数据/,
    );
    await assert.rejects(
        searchLyrics(query, {
            fetcher: async () => {
                throw new TypeError('Failed to fetch');
            },
        }),
        /无法连接/,
    );
    const controller = new AbortController();
    controller.abort();
    await assert.rejects(
        searchLyrics(query, {
            signal: controller.signal,
            fetcher: async () => Response.json(fixtures),
        }),
        { name: 'AbortError' },
    );
    await assert.rejects(searchLyrics({ title: '' }), /填写歌曲名称/);
});
test('lyric response limits reject oversized network data instead of truncating and claiming a match', async () => {
    await assert.rejects(
        searchLyrics({ title: 'x' }, { fetcher: async () => new Response('x'.repeat(2 * 1024 * 1024 + 1)) }),
        /过大/,
    );
});
test('selected lyrics and source survive settings migration and standalone card export, with no network at recipient', async () => {
    const track = {
        id: 'song',
        kind: 'local',
        title: 'Demo',
        lyrics: fixtures[0].syncedLyrics,
        lyricsSource: 'https://lrclib.net/api/get/1',
    };
    assert.equal(normalizeSettings({ tracks: [track] }).tracks[0].lyricsSource, track.lyricsSource);
    const result = await prepareCardPackage(
        { id: 'test', tracks: [track], appearance: {} },
        {
            getBlob: async () => new Blob(['fixture'], { type: 'audio/mpeg' }),
            readFallback: async () => new Blob(['cover'], { type: 'image/png' }),
            probeAudio: async () => {},
        },
    );
    const files = buildCardExports(
        result.config,
        'const RisereinCardPlayer={startCharacterPlayer(){},startPreview(){}};',
        'script',
    );
    const card = attachPlayerToCard({ spec: 'chara_card_v2', data: { name: 'Demo' } }, files.script, 'test');
    assert.equal(verifyCardObject(card, { script: files.script }).static, 'passed');
    const saved = readScriptPayload(files.javascript).tracks[0];
    assert.equal(saved.lyrics, track.lyrics);
    assert.equal(saved.lyricsSource, track.lyricsSource);
});
