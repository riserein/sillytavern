import { readingPalette, colorChannels, readableColor, readabilityReport } from './contrast.js';

export function normalizeReading(raw = {}) {
    raw = raw && typeof raw === 'object' ? raw : {};
    const bounded = (value, fallback, min, max) => typeof value === 'number' && Number.isFinite(value) ? Math.max(min, Math.min(max, value)) : fallback;
    return {
        level: ['standard', 'clear', 'high'].includes(raw.level) ? raw.level : 'clear',
        lyricSize: bounded(raw.lyricSize, 20, 18, 30),
        lineHeight: bounded(raw.lineHeight, 1.9, 1.5, 2.6),
        autoFollow: raw.autoFollow !== false,
        lyricBackground: ['auto', 'transparent', 'soft'].includes(raw.lyricBackground) ? raw.lyricBackground : 'auto',
    };
}

export function sourceReadingPalette(panel) {
    const css = getComputedStyle(panel), value = (key, fallback) => {
        const color = css.getPropertyValue(key).trim(); return colorChannels(color) ? color : fallback;
    };
    return { background: value('--stm-solid', '#182220'), text: value('--stm-body', '#e8eee6'), muted: value('--stm-muted', '#b2c3b1'), accent: value('--stm-accent', '#b2c3b1') };
}

export function applyReading(panel, launcher, input, design) {
    const settings = normalizeReading(input), source = sourceReadingPalette(panel), palette = readingPalette(source, settings.level);
    for (const root of [panel, launcher]) {
        root.dataset.reading = settings.level;
        root.dataset.lyricBackground = settings.lyricBackground;
        for (const [key, value] of Object.entries(palette)) root.style.setProperty('--read-' + key.replace(/[A-Z]/g, c => '-' + c.toLowerCase()), value);
        root.style.setProperty('--read-lyric-size', settings.lyricSize + 'px');
        root.style.setProperty('--read-line-height', String(settings.lineHeight));
    }
    // Component colors/opacity cannot make essential text disappear. Preserve the
    // saved design; correct only its presentation against the local reading plate.
    for (const id of ['title', 'artist', 'lyrics', 'queue', 'controls', 'volume']) {
        const rule = design?.components?.[id];
        for (const node of panel.querySelectorAll('[data-design-component="' + id + '"]')) {
            node.style.setProperty('--read-component-color', readableColor(rule?.color || palette.body, [palette.surface], 4.5));
            const size = parseFloat(getComputedStyle(node).fontSize) || 14;
            node.style.setProperty('zoom', String(Math.max(13 / size, rule?.size ?? 1)));
        }
    }
    return { palette, source, checks: readabilityReport(source, design?.components) };
}

export function createReadingControls({ panel, settings, onChange, mount = panel.querySelector('#stm-appearance') }) {
    const group = panel.ownerDocument.createElement('details'), abort = new AbortController();
    group.className = 'stm-settings-group stm-reading-settings'; group.open = true;
    group.innerHTML = '<summary>文字与阅读</summary><label for="stm-reading-level">文字显示</label><select id="stm-reading-level"><option value="standard">标准</option><option value="clear">清晰</option><option value="high">高对比度</option></select><label for="stm-lyric-size">歌词字号 <output data-reading-size></output></label><input id="stm-lyric-size" type="range" min="18" max="30" step="1"><label for="stm-lyric-height">歌词行距 <output data-reading-height></output></label><input id="stm-lyric-height" type="range" min="1.5" max="2.6" step="0.1"><label class="stm-check-label"><input id="stm-lyric-follow" type="checkbox">歌词自动跟随</label><label for="stm-lyric-background">歌词阅读背景</label><select id="stm-lyric-background"><option value="auto">自动</option><option value="transparent">透明</option><option value="soft">柔和遮罩</option></select><p class="stm-hint">手动滚动后暂停跟随，点击“回到当前歌词”恢复。透明背景仍保留文字局部衬底，保护复杂图片上的可读性。</p>';
    mount.prepend(group);
    const q = selector => group.querySelector(selector);
    const fields = [['#stm-reading-level', 'level', 'change'], ['#stm-lyric-size', 'lyricSize', 'input'], ['#stm-lyric-height', 'lineHeight', 'input'], ['#stm-lyric-follow', 'autoFollow', 'change'], ['#stm-lyric-background', 'lyricBackground', 'change']];
    for (const [selector, key, event] of fields) q(selector).addEventListener(event, e => {
        const value = e.target.type === 'checkbox' ? e.target.checked : e.target.type === 'range' ? Number(e.target.value) : e.target.value;
        settings.reading = normalizeReading({ ...settings.reading, [key]: value }); onChange(key); refresh();
    }, { signal: abort.signal });
    function refresh() {
        const reading = normalizeReading(settings.reading);
        for (const [selector, key] of fields) { const node = q(selector); if (node.type === 'checkbox') node.checked = reading[key]; else node.value = String(reading[key]); }
        q('[data-reading-size]').textContent = reading.lyricSize + ' px'; q('[data-reading-height]').textContent = reading.lineHeight.toFixed(1);
    }
    refresh();
    return { group, refresh, dispose() { abort.abort(); group.remove(); } };
}
