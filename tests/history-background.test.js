import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeSettings, recordPlayback, recentTracks, rankedTracks, deleteTrackFromLibrary, THREE_DAYS } from '../core.js';
import { cropRectangle, validateImageFile, MAX_IMAGE_BYTES } from '../background.js';

const now = 1_800_000_000_000;
const tracks = Array.from({ length: 120 }, (_, i) => ({ id: String(i), kind: 'local', title: `Song ${i}` }));

test('recent listening keeps 100 distinct songs, moving replays to the top', () => {
    const settings = normalizeSettings({ tracks }, now);
    tracks.forEach((track, i) => recordPlayback(settings, track.id, now + i));
    assert.equal(recentTracks(settings).length, 100);
    assert.equal(recentTracks(settings)[0].track.id, '119');
    assert.equal(recentTracks(settings).at(-1).track.id, '20');
    recordPlayback(settings, '30', now + 121);
    assert.equal(recentTracks(settings)[0].track.id, '30');
    assert.equal(recentTracks(settings).length, 100);
    assert.equal(settings.playEvents.length, 121);
});

test('rankings count exact rolling 72 hours, sort by count then last play, and expire independently of recents', () => {
    const settings = normalizeSettings({ tracks }, now);
    recordPlayback(settings, '0', now - THREE_DAYS);
    recordPlayback(settings, '1', now - 1000);
    recordPlayback(settings, '1', now - 500);
    recordPlayback(settings, '2', now - 200);
    recordPlayback(settings, '3', now - 100);
    assert.deepEqual(rankedTracks(settings, now).map(item => [item.track.id, item.count]), [['1', 2], ['3', 1], ['2', 1]]);
    assert.equal(rankedTracks(settings, now + THREE_DAYS).length, 0);
    assert.equal(recentTracks(settings).length, 4);
    recordPlayback(settings, '3', now + THREE_DAYS);
    assert.equal(settings.playEvents.length, 1);
});

test('history restores valid metadata and global deletion removes every record', () => {
    const raw = { tracks, recentPlays: [{ trackId: '1', at: now - THREE_DAYS - 1 }, { trackId: '1', at: now - 1 }, { trackId: 'missing', at: now }, null],
        playEvents: [{ trackId: '1', at: now - 1 }, { trackId: '1', at: now - THREE_DAYS }, { trackId: '2', at: now + 1 }, { trackId: 'missing', at: now }] };
    const settings = normalizeSettings(raw, now);
    assert.deepEqual(settings.recentPlays, [{ trackId: '1', at: now - 1 }]);
    assert.deepEqual(settings.playEvents, [{ trackId: '1', at: now - 1 }]);
    deleteTrackFromLibrary(settings, '1');
    assert.deepEqual(settings.recentPlays, []);
    assert.deepEqual(settings.playEvents, []);
    assert.doesNotThrow(() => recordPlayback(settings, 'missing', now));
});

test('clear material is restored only with a valid local background reference', () => {
    assert.equal(normalizeSettings({ surface: 'clear' }).surface, 'glass');
    const id = 'background:12cf4785-e913-4f85-b372-72312d1974d3';
    const restored = normalizeSettings({ surface: 'clear', backgroundId: id });
    assert.equal(restored.backgroundId, id);
    assert.equal(restored.surface, 'clear');
    assert.equal(normalizeSettings({ backgroundId: 'https://outside/image.png', surface: 'clear' }).backgroundId, null);
});

test('portrait crop remains in bounds for wide, tall, zoomed and off-edge images', () => {
    for (const [width, height] of [[1600, 900], [400, 1600], [300, 450]]) {
        for (const zoom of [1, 2, 4]) for (const x of [-1, 0, .5, 1, 2]) for (const y of [0, .5, 1]) {
            const rect = cropRectangle(width, height, { zoom, x, y });
            assert.ok(Math.abs(rect.width / rect.height - 2 / 3) < 1e-10);
            assert.ok(rect.x >= 0 && rect.y >= 0);
            assert.ok(rect.x + rect.width <= width + 1e-8 && rect.y + rect.height <= height + 1e-8);
        }
    }
    assert.equal(cropRectangle(1200, 900, { x: 0 }).x, 0);
    assert.equal(cropRectangle(1200, 900, { x: 1 }).x, 600);
    assert.throws(() => cropRectangle(0, 100));
});

test('image import rejects empty, oversized, non-image and SVG input', () => {
    assert.doesNotThrow(() => validateImageFile({ type: 'image/jpeg', size: 1000 }));
    for (const file of [{ type: 'image/jpeg', size: 0 }, { type: 'image/png', size: MAX_IMAGE_BYTES + 1 }, { type: 'audio/mpeg', size: 100 }, { type: 'image/svg+xml', size: 100 }]) assert.throws(() => validateImageFile(file));
});
