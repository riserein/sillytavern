import test from 'node:test';
import assert from 'node:assert/strict';
import { contrastRatio, compositeColor, readableColor, readingPalette, readableColors, readabilityReport } from '../ui/contrast.js';
import { normalizeReading } from '../ui/reading.js';
import { normalizeSettings } from '../core.js';
import { themePalette } from '../scheme.js';
import { designPalette, DESIGN_THEMES } from '../ui/config.js';
import { safeSettings } from '../data/backup.js';

test('contrast combines actual alpha before measuring and rejects uncomposited alpha', () => {
    assert.equal(contrastRatio('#000000', '#ffffff'), 21);
    assert.equal(compositeColor('rgba(255, 255, 255, 0.5)', '#000000'), '#808080');
    assert.throws(() => contrastRatio('rgba(255, 255, 255, 0.5)', '#000000'));
    assert(contrastRatio(readableColor('#888888', ['#858585']), '#858585') >= 4.5);
});
test('every old and new preset has opaque readable semantic text on its protected local surfaces', () => {
    for (const scheme of ['light', 'dark']) {
        const sources = ['night', 'amber', 'ocean', 'forest', 'rose', 'lavender', 'pearl'].map(theme => {
            const p = themePalette(theme, scheme);
            return { background: p['--stm-solid'], text: p['--stm-body'], muted: p['--stm-muted'], accent: p['--stm-accent'] };
        }).concat(Object.keys(DESIGN_THEMES).filter(t => t !== 'inherit').map(theme => designPalette(theme, scheme)));
        for (const source of sources) for (const level of ['standard', 'clear', 'high']) {
            const p = readingPalette(source, level);
            for (const name of ['title', 'body', 'secondary', 'hint', 'lyrics', 'current', 'accent', 'error', 'warning']) assert(contrastRatio(p[name], p.surface) >= 4.5, `${scheme} ${name}`);
            assert(contrastRatio(p.onAction, p.action) >= 4.5);
            assert(contrastRatio(p.accent, p.selected) >= 4.5);
        }
    }
});
test('low contrast custom colors are safe to display without mutating or silently unlocking author colors', () => {
    const colors = { background: '#858585', text: '#858585', accent: '#858585', muted: '#858585' }, before = structuredClone(colors);
    const palette = readingPalette(colors);
    assert(contrastRatio(palette.lyrics, palette.surface) >= 4.5);
    assert.deepEqual(colors, before);
    const high = readingPalette(colors, 'high');
    assert(contrastRatio(high.body, high.surface) >= 9);
    assert.deepEqual(readableColors(colors, new Set(Object.keys(colors))), before);
    assert(readabilityReport(colors).some(row => row.ratio < 4.5));
    assert(contrastRatio(readableColors(colors).muted, readableColors(colors).background) >= 4.5);
});
test('unframed shell text stays readable over image extremes without changing saved colors', () => {
    for (const scheme of ['dark', 'light']) for (const theme of Object.keys(DESIGN_THEMES)) {
        const source = theme === 'inherit' ? { background:'#858585',text:'#858585',muted:'#858585',accent:'#858585' } : designPalette(theme, scheme);
        const original = structuredClone(source);
        for (const level of ['standard','clear','high']) {
            const p = readingPalette(source,level), backgrounds = [p.surface,...['#000000','#ffffff'].map(bg=>compositeColor(p.surface+'e5',bg))];
            for (const name of ['body','title','secondary','hint','accent','error','warning','button']) for (const bg of backgrounds) assert(contrastRatio(p[name],bg)>=4.5,`${theme}/${scheme}/${level}/${name}`);
            for (const bg of backgrounds) assert(contrastRatio(p.body,bg)>=(level==='high'?9:level==='clear'?7:4.5));
        }
        assert.deepEqual(source,original);
    }
});
test('new reading preferences normalize bounded data and old libraries retain their data', () => {
    assert.deepEqual(normalizeReading(), { level: 'clear', lyricSize: 20, lineHeight: 1.9, autoFollow: true, lyricBackground: 'auto', displayMode: 'flow', nextLine: true });
    assert.deepEqual(normalizeReading({ level: 'execute', lyricSize: Infinity, lineHeight: 0, autoFollow: false, lyricBackground: '<svg>' }), { level: 'clear', lyricSize: 20, lineHeight: 1.5, autoFollow: false, lyricBackground: 'auto', displayMode: 'flow', nextLine: true });
    const original = { tracks: [{ id: 'x', kind: 'local', title: '旧曲', lyrics: '[00:01]原始歌词' }], playlists: [{ id: 'l', name: '旧歌单', trackIds: ['x'], characterAvatars: ['old.png'] }], reading: { lyricSize: 26, level: 'high', autoFollow: false } };
    const next = normalizeSettings(original);
    assert.equal(next.tracks[0].lyrics, original.tracks[0].lyrics);
    assert.deepEqual(next.playlists[0].characterAvatars, ['old.png']);
    assert.equal(next.reading.lyricSize, 26);
    assert.deepEqual(safeSettings(next).reading, next.reading);
});
