import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MAX_TRACKS, MAX_FILE_BYTES, createTrackId, normalizeSettings, normalizeUrl, titleFromUrl, nextTrackId, formatTime, validateAudioFile } from '../core.js';

const tracks = ['a', 'b', 'c'].map(id => ({ id, kind: 'local', title: id }));

test('new playlists have safe playback defaults', () => {
    assert.deepEqual(normalizeSettings(), {
        tracks: [], volume: 0.6, mode: 'list', currentId: null, favorites: [], transitionDuration: 300,
        playlists: [], activePlaylistId: null, builtinHidden: false,
        backgroundId: null, recentPlays: [], playEvents: [],
        customColors: { enabled: false, accent: '#dbc291', background: '#25211e', text: '#f0e9dc' },
        maskOpacity: { matte: null, glass: null }, clickEffects: true,
        fonts: [], fontPreset: 'inherit', fontId: null, fontName: '',
        colorScheme: 'system', panelSize: null,
        theme: 'amber', surface: 'glass', positions: { launcher: null, panel: null },
    });
    assert.equal(normalizeSettings(null).volume, 0.6);
    assert.equal(normalizeSettings({ volume: NaN, mode: 'bad', currentId: 'missing' }).mode, 'list');
    assert.equal(normalizeSettings({ volume: 50 }).volume, 1);
    assert.equal(normalizeSettings({ volume: -2 }).volume, 0);
});

test('old settings migrate without losing music and invalid appearance/positions recover', () => {
    const old = normalizeSettings({ tracks, currentId: 'b', volume: 0.3 });
    assert.equal(old.theme, 'amber');
    assert.equal(old.surface, 'glass');
    assert.deepEqual(old.tracks, tracks);
    assert.equal(old.currentId, 'b');
    const settings = normalizeSettings({ theme: 'unknown', surface: 'unknown', positions: { launcher: { x: -2, y: 5 }, panel: { x: NaN, y: 0.5 } } });
    assert.equal(settings.theme, 'amber');
    assert.equal(settings.surface, 'glass');
    assert.deepEqual(settings.positions, { launcher: { x: 0, y: 1 }, panel: null });
    assert.equal(normalizeSettings({ theme: 'pearl', surface: 'matte' }).theme, 'pearl');
    assert.equal(normalizeSettings({ theme: 'pearl', surface: 'matte' }).surface, 'matte');
});

test('restoration removes invalid URLs and duplicate IDs, retaining valid local files', () => {
    const settings = normalizeSettings({ tracks: [...tracks, tracks[0], null, { id: 'x', kind: 'url', url: 'javascript:alert(1)' }], currentId: 'b' });
    assert.deepEqual(settings.tracks, tracks);
    assert.equal(settings.currentId, 'b');
    assert.equal(normalizeSettings({ tracks, currentId: 'missing' }).currentId, 'a');
    assert.equal(normalizeSettings({ tracks: Array.from({ length: 250 }, (_, n) => ({ id: String(n), kind: 'local' })) }).tracks.length, MAX_TRACKS);
});

test('direct URLs must use HTTP(S) and must not embed credentials', () => {
    assert.equal(normalizeUrl(' https://example.com/a.mp3 '), 'https://example.com/a.mp3');
    for (const value of ['javascript:alert(1)', 'data:audio/wav;base64,aaa', 'file:///a.mp3', '/a.mp3', 'https://user:pass@example.com/a.mp3']) {
        assert.throws(() => normalizeUrl(value));
    }
});

test('titles decode filenames without executing markup', () => {
    assert.equal(titleFromUrl('https://example.com/%E9%9B%A8%E5%A3%B0.mp3?token=a'), '雨声');
    assert.equal(titleFromUrl('https://example.com/'), 'example.com');
    assert.equal(titleFromUrl('https://example.com/%3Cimg%3E.mp3'), '<img>');
    assert.equal(titleFromUrl('https://example.com/%broken.mp3'), '%broken');
});

test('list navigation wraps in both directions', () => {
    assert.equal(nextTrackId(tracks, 'c', 'list'), 'a');
    assert.equal(nextTrackId(tracks, 'a', 'list', { direction: -1 }), 'c');
    assert.equal(nextTrackId([], 'a', 'list'), null);
    assert.equal(nextTrackId(tracks, 'missing', 'list'), 'a');
});

test('sequence stops after the last song only on automatic completion', () => {
    assert.equal(nextTrackId(tracks, 'c', 'sequence', { ended: true }), null);
    assert.equal(nextTrackId(tracks, 'b', 'sequence', { ended: true }), 'c');
    assert.equal(nextTrackId(tracks, 'c', 'sequence'), 'a');
});

test('single repeat does not block manual switching', () => {
    assert.equal(nextTrackId(tracks, 'b', 'single', { ended: true }), 'b');
    assert.equal(nextTrackId(tracks, 'b', 'single'), 'c');
});

test('shuffle avoids immediately repeating a song when alternatives exist', () => {
    for (const random of [0, 0.2, 0.5, 0.999]) {
        assert.notEqual(nextTrackId(tracks, 'b', 'shuffle', { random: () => random }), 'b');
    }
    assert.equal(nextTrackId([tracks[0]], 'a', 'shuffle'), 'a');
});

test('progress formatting handles invalid and long durations', () => {
    assert.equal(formatTime(65.9), '1:05');
    assert.equal(formatTime(3601), '60:01');
    for (const value of [NaN, Infinity, -1, 0]) assert.equal(formatTime(value), '0:00');
});

test('imports reject unsupported, empty and oversized files', () => {
    assert.doesNotThrow(() => validateAudioFile({ name: 'rain.mp3', type: '', size: 100 }));
    assert.doesNotThrow(() => validateAudioFile({ name: 'sound', type: 'audio/wav', size: 100 }));
    assert.throws(() => validateAudioFile({ name: 'script.js', type: 'text/javascript', size: 100 }));
    assert.throws(() => validateAudioFile({ name: 'empty.mp3', type: 'audio/mpeg', size: 0 }));
    assert.throws(() => validateAudioFile({ name: 'large.mp3', type: 'audio/mpeg', size: MAX_FILE_BYTES + 1 }));
});

test('track IDs work on HTTP sites without randomUUID', () => {
    const source = { getRandomValues: array => { array.fill(1); return array; } };
    assert.match(createTrackId(source), /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/);
    assert.notEqual(createTrackId(), createTrackId());
});
