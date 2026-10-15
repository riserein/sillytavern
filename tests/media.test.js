import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readEmbeddedMetadata, parseLyrics, currentLyricIndex, randomCover, COVER_COUNT } from '../media.js';
import { normalizeSettings } from '../core.js';
import { validateFontFile, normalizeFonts, FONT_PRESETS, MAX_FONTS } from '../fonts.js';

const syncSize = size => Buffer.from([size >> 21 & 127, size >> 14 & 127, size >> 7 & 127, size & 127]);
function frame(id, data, version) {
    const header = Buffer.alloc(10); header.write(id);
    if (version === 4) syncSize(data.length).copy(header, 4); else header.writeUInt32BE(data.length, 4);
    return Buffer.concat([header, data]);
}
function mp3(version = 3) {
    const text = value => Buffer.concat([Buffer.from([3]), Buffer.from(value)]);
    const image = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
    const frames = Buffer.concat([
        frame('TIT2', text('雨落书窗'), version), frame('TPE1', text('测试歌手'), version),
        frame('APIC', Buffer.concat([Buffer.from([0]), Buffer.from('image/png\0'), Buffer.from([3, 0]), image]), version),
        frame('USLT', Buffer.concat([Buffer.from([3]), Buffer.from('zho\0[00:01.00]窗外下起了雨')]), version),
    ]);
    return new Blob([Buffer.concat([Buffer.from('ID3'), Buffer.from([version, 0, 0]), syncSize(frames.length), frames])]);
}
test('ID3 v2.3 and v2.4 recover real title, artist, embedded art and lyrics', async () => {
    for (const version of [3, 4]) {
        const result = await readEmbeddedMetadata(mp3(version));
        assert.equal(result.title, '雨落书窗'); assert.equal(result.artist, '测试歌手');
        assert.equal(result.cover.type, 'image/png'); assert.equal(result.cover.size, 8);
        assert.equal(result.lyrics, '[00:01.00]窗外下起了雨');
    }
});
test('non-MP3 and damaged or oversized ID3 frames leave audio import usable', async () => {
    assert.deepEqual(await readEmbeddedMetadata(new Blob(['RIFF0123456789'])), {});
    assert.deepEqual(await readEmbeddedMetadata(new Blob(['ID3\u0003\0\0\u007f\u007f\u007f\u007f'])), {});
    const broken = Buffer.concat([Buffer.from('ID3'), Buffer.from([3, 0, 0]), syncSize(10), Buffer.from('APIC\xff\xff\xff\xff\0\0', 'latin1')]);
    assert.deepEqual(await readEmbeddedMetadata(new Blob([broken])), {});
});
test('LRC multi-stamps, millisecond precision, offsets and active-line lookup work', () => {
    const result = parseLyrics('[ar:某人]\n[offset:500]\n[00:02.25][00:03.500]同一句\n[00:01.00]第一句');
    assert.equal(result.synced, true);
    assert.deepEqual(result.lines.map(line => line.time), [.5, 1.75, 3]);
    assert.equal(currentLyricIndex(result.lines, .4), -1);
    assert.equal(currentLyricIndex(result.lines, 2), 1);
    assert.equal(currentLyricIndex(result.lines, 99), 2);
    assert.equal(parseLyrics('普通歌词\n第二行').synced, false);
    assert.equal(parseLyrics('普通歌词\n第二行').lines[1].text, '第二行');
});
test('media metadata migrates safely while preserving existing audio identifiers', () => {
    const settings = normalizeSettings({ tracks: [{ id: 'original', kind: 'local', title: 'old', artist: '歌手', lyrics: '歌词', coverId: 'cover:12cf4785-e913-4f85-b372-72312d1974d3', fallbackCover: 1 }], fontPreset: 'genwan' });
    assert.equal(settings.tracks[0].id, 'original'); assert.equal(settings.tracks[0].artist, '歌手');
    assert.equal(settings.tracks[0].fallbackCover, 1); assert.equal(settings.fontPreset, 'genwan');
    assert.equal(normalizeSettings({ fontPreset: 'toString' }).fontPreset, 'inherit');
    assert.equal(randomCover(() => .999), COVER_COUNT - 1);
    assert.equal(randomCover(() => 0), 0);
});
test('local font import only accepts bounded supported font files', () => {
    assert.doesNotThrow(() => validateFontFile({ name: 'song.woff2', size: 10000 }));
    assert.throws(() => validateFontFile({ name: 'fake.css', size: 1000 }));
    assert.throws(() => validateFontFile({ name: 'large.otf', size: 21 * 1024 * 1024 }));
    assert.throws(() => validateFontFile({ name: 'empty.ttf', size: 0 }));
});

test('font library migration preserves old blob IDs, selection, stable order and valid hashes', () => {
    const id = 'font:12cf4785-e913-4f85-b372-72312d1974d3';
    const second = 'font:22cf4785-e913-4f85-b372-72312d1974d3';
    const old = normalizeFonts({ fontPreset: 'custom', fontId: id, fontName: '原来的字体' });
    assert.deepEqual(old, { fonts: [{ id, name: '原来的字体' }], fontPreset: 'custom', fontId: id, fontName: '原来的字体' });
    const many = normalizeFonts({ ...old, fonts: [{ id: second, name: '新字体', hash: 'a'.repeat(64) }, ...old.fonts, { id, name: '重复' }, null, { id: '../bad', name: 'bad' }] });
    assert.deepEqual(many.fonts.map(font => font.id), [second, id]);
    assert.equal(many.fonts[0].hash, 'a'.repeat(64));
    assert.deepEqual(normalizeFonts(many), many);
    for (const key of ['genwan', 'poxiao', 'chill', 'ukai', 'child', 'kinghwa', 'huiwen']) {
        assert.equal(normalizeSettings({ fontPreset: key }).fontPreset, key);
        assert.ok(FONT_PRESETS[key].file);
    }
    assert.equal(normalizeFonts({ fontPreset: 'custom', fontId: 'bad' }).fontPreset, 'inherit');
    assert.equal(normalizeFonts({ fontPreset: '__proto__' }).fontPreset, 'inherit');
    const full = Array.from({ length: MAX_FONTS + 10 }, (_, i) => ({ id: `font:${String(i).padStart(8, '0')}-e913-4f85-b372-72312d1974d3`, name: 'x'.repeat(100), hash: 'bad' }));
    const bounded = normalizeFonts({ fonts: full, fontPreset: 'custom', fontId: id, fontName: 'active' });
    assert.equal(bounded.fonts.length, MAX_FONTS);
    assert.equal(bounded.fontId, id);
    assert.equal(bounded.fonts[0].name.length, 80);
    assert.equal(bounded.fonts[0].hash, undefined);
});
