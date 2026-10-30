import { readingPalette, colorChannels, readableColor, readabilityReport, compositeColor } from './contrast.js';

export function normalizeReading(raw = {}) {
    raw = raw && typeof raw === 'object' ? raw : {};
    const bounded = (value, fallback, min, max) => typeof value === 'number' && Number.isFinite(value) ? Math.max(min, Math.min(max, value)) : fallback;
    return {
        level: ['standard', 'clear', 'high'].includes(raw.level) ? raw.level : 'clear',
        lyricSize: bounded(raw.lyricSize, 20, 18, 30),
        lineHeight: bounded(raw.lineHeight, 1.9, 1.5, 2.6),
        autoFollow: raw.autoFollow !== false,
        lyricBackground: ['auto', 'transparent', 'soft'].includes(raw.lyricBackground) ? raw.lyricBackground : 'auto',
        displayMode: ['flow', 'centered', 'immersive'].includes(raw.displayMode) ? raw.displayMode : 'flow',
        nextLine: raw.nextLine !== false,
        lyricLanguage:['original','both','translation'].includes(raw.lyricLanguage)?raw.lyricLanguage:'both',
        translationSize:bounded(raw.translationSize,16,14,30),translationHeight:bounded(raw.translationHeight,1.7,1.4,2.6),translationGap:bounded(raw.translationGap,6,0,18),
        originalColor:/^#[a-f0-9]{6}$/i.test(raw.originalColor)?raw.originalColor:null,translationColor:/^#[a-f0-9]{6}$/i.test(raw.translationColor)?raw.translationColor:null,
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
        root.dataset.lyricLanguage=settings.lyricLanguage;
        const backgrounds=['#000000','#ffffff'].map(bg=>compositeColor(palette.lyricSurface+'e5',bg));
        root.style.setProperty('--read-original',readableColor(settings.originalColor||palette.lyrics,backgrounds,7));root.style.setProperty('--read-translation',readableColor(settings.translationColor||palette.secondary,backgrounds,4.5));
        root.style.setProperty('--read-translation-size',settings.translationSize+'px');root.style.setProperty('--read-translation-height',String(settings.translationHeight));root.style.setProperty('--read-translation-gap',settings.translationGap+'px');

    }
    // Component colors/opacity cannot make essential text disappear. Preserve the
    // saved design; correct only presentation against the continuous shell veil.
    const backgrounds = [palette.surface, ...['#000000', '#ffffff'].map(bg => compositeColor(palette.surface + 'e5', bg))];
    for (const id of ['title', 'artist', 'lyrics', 'queue', 'controls', 'volume']) {
        const rule = design?.components?.[id];
        for (const node of panel.querySelectorAll('[data-design-component="' + id + '"]')) {
            node.style.setProperty('--read-component-color', readableColor(rule?.color || palette.body, backgrounds, 4.5));
            const size = parseFloat(getComputedStyle(node).fontSize) || 14;
            node.style.setProperty('zoom', String(Math.max(13 / size, rule?.size ?? 1)));
        }
    }
    return { palette, source, checks: readabilityReport(source, design?.components) };
}

export function createReadingControls({ panel, settings, onChange, getTranslationState=()=>({}), mount = panel.querySelector('#stm-appearance') }) {
    const group = panel.ownerDocument.createElement('details'), abort = new AbortController();
    group.className = 'stm-settings-group stm-reading-settings'; group.open = true;
    group.innerHTML = '<summary>文字与阅读</summary><label for="stm-reading-level">文字显示</label><select id="stm-reading-level"><option value="standard">标准</option><option value="clear">清晰</option><option value="high">高对比度</option></select><label for="stm-lyric-size">歌词字号 <output data-reading-size></output></label><input id="stm-lyric-size" type="range" min="18" max="30" step="1"><label for="stm-lyric-height">歌词行距 <output data-reading-height></output></label><input id="stm-lyric-height" type="range" min="1.5" max="2.6" step="0.1"><label class="stm-check-label"><input id="stm-lyric-follow" type="checkbox">歌词自动跟随</label><label for="stm-lyric-background">歌词阅读背景</label><select id="stm-lyric-background"><option value="auto">自动</option><option value="transparent">透明</option><option value="soft">柔和遮罩</option></select><p class="stm-hint">手动滚动后暂停跟随，点击“回到当前歌词”恢复。透明模式仍保留一层整体柔和遮罩，不为每句歌词单独加框。</p>';
    const modes = panel.ownerDocument.createElement('div');
    modes.innerHTML = '<label for="stm-lyric-mode">歌词显示模式</label><select id="stm-lyric-mode"><option value="flow">连续滚动</option><option value="centered">居中阅读</option><option value="immersive">单句沉浸</option></select><label class="stm-check-label"><input id="stm-lyric-next" type="checkbox">单句模式显示下一句</label>';
    const bilingual=panel.ownerDocument.createElement('details');bilingual.className='stm-bilingual-reading';bilingual.innerHTML='<summary>双语歌词排版</summary><label>歌词语言<select id="stm-lyric-language"><option value="original">仅原文</option><option value="both">原文 + 译文</option><option value="translation">仅译文</option></select></label><label>译文字号<input type="range" id="stm-translation-size" min="14" max="30" step="1"></label><label>译文行距<input type="range" id="stm-translation-height" min="1.4" max="2.6" step="0.1"></label><label>原译间距<input type="range" id="stm-translation-gap" min="0" max="18" step="1"></label><label>自定原文颜色<input type="color" id="stm-original-color"></label><label>自定译文颜色<input type="color" id="stm-translation-color"></label><button type="button" class="stm-secondary" data-translation-colors-reset>恢复歌词主题颜色</button><p class="stm-hint">原文字号和行距使用上方歌词设置。颜色仍会经过可读性保护；未匹配译文的句子保留原文。</p>';
    group.append(bilingual);
    group.prepend(modes);
    mount.prepend(group);
    const q = selector => group.querySelector(selector);
    const fields = [['#stm-lyric-language','lyricLanguage','change'],['#stm-translation-size','translationSize','input'],['#stm-translation-height','translationHeight','input'],['#stm-translation-gap','translationGap','input'],['#stm-original-color','originalColor','input'],['#stm-translation-color','translationColor','input'],['#stm-lyric-mode', 'displayMode', 'change'], ['#stm-lyric-next', 'nextLine', 'change'], ['#stm-reading-level', 'level', 'change'], ['#stm-lyric-size', 'lyricSize', 'input'], ['#stm-lyric-height', 'lineHeight', 'input'], ['#stm-lyric-follow', 'autoFollow', 'change'], ['#stm-lyric-background', 'lyricBackground', 'change']];
    for (const [selector, key, event] of fields) q(selector).addEventListener(event, e => {
        const value = e.target.type === 'checkbox' ? e.target.checked : e.target.type === 'range' ? Number(e.target.value) : e.target.value;
        settings.reading = normalizeReading({ ...settings.reading, [key]: value }); onChange(key); refresh();
    }, { signal: abort.signal });
    function refresh() {
        const reading = normalizeReading(settings.reading);
        for (const [selector, key] of fields) { const node = q(selector); if (node.type === 'checkbox') node.checked = reading[key]; else node.value = node.type==='color'?(reading[key]||'#b2c3b1'):String(reading[key]); }
        const available=!!getTranslationState().translationAvailable,language=q('#stm-lyric-language');for(const option of language.options)option.disabled=option.value!=='original'&&!available;if(!available)language.value='original';
        q('[data-reading-size]').textContent = reading.lyricSize + ' px'; q('[data-reading-height]').textContent = reading.lineHeight.toFixed(1);
    }
    q('[data-translation-colors-reset]').addEventListener('click',()=>{settings.reading=normalizeReading({...settings.reading,originalColor:null,translationColor:null});onChange('translationColor');refresh();},{signal:abort.signal});
    refresh();
    return { group, refresh, dispose() { abort.abort(); group.remove(); } };
}
