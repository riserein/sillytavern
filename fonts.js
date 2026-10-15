export const FONT_PRESETS = {
    inherit: { name: '跟随酒馆', family: 'inherit' },
    sans: { name: '清爽黑体', family: '"Noto Sans SC", "PingFang SC", "Microsoft YaHei", sans-serif' },
    song: { name: '典雅宋体', family: '"Noto Serif SC", "Songti SC", SimSun, serif' },
    kai: { name: '温润楷书', family: 'KaiTi, STKaiti, "Kaiti SC", serif' },
    fang: { name: '书卷仿宋', family: 'FangSong, STFangsong, serif' },
    genwan: { name: '源雲明體 · 内置', family: '"stm-genwan", "Noto Serif SC", SimSun, serif', file: 'GenWanMin2TC-R.woff2', original: 'GenWanMin2 TC R' },
    poxiao: { name: '破晓像素', family: '"stm-poxiao", sans-serif', file: 'PoxiaoPixel.woff2', original: 'PoxiaoPixel' },
    chill: { name: '寒蝉活宋', family: '"stm-chill", serif', file: 'ChillHuoSong_F.woff2', original: 'ChillHuoSong_F' },
    ukai: { name: '文鼎楷体', family: '"stm-ukai", serif', file: 'AR-PL-UKai-CN.woff2', original: 'AR PL UKai CN' },
    child: { name: '游趣体', family: '"stm-child", sans-serif', file: 'ChildFunSans.woff2', original: 'Child Fun Sans' },
    kinghwa: { name: '京华老宋体', family: '"stm-kinghwa", serif', file: 'KingHwaOldSong.ttf', original: 'KingHwaOldSong' },
    huiwen: { name: '汇文明朝', family: '"stm-huiwen", serif', file: 'Huiwen-mincho.woff2', original: 'Huiwen-mincho · 符号修正版' },
    custom: { name: '导入的字体', family: 'inherit' },
};
export const MAX_FONTS = 20;
export const FONT_SAMPLE = '听见故事里的风，收藏每一段心动。';
export const FONT_LATIN_SAMPLE = 'Music & Dreams · 0123456789';
const validFontId = id => typeof id === 'string' && /^font:[a-f0-9-]{36}$/.test(id);

/** Keep the old single-font selection and its blob ID when upgrading. */
export function normalizeFonts(raw) {
    const fonts = [];
    const seen = new Set();
    const add = item => {
        if (!item || !validFontId(item.id) || seen.has(item.id) || fonts.length >= MAX_FONTS) return;
        seen.add(item.id);
        const font = { id: item.id, name: String(item.name || '导入的字体').slice(0, 80) };
        if (typeof item.hash === 'string' && /^[a-f0-9]{64}$/.test(item.hash)) font.hash = item.hash;
        fonts.push(font);
    };
    if (Array.isArray(raw.fonts)) raw.fonts.forEach(add);
    if (validFontId(raw.fontId) && !seen.has(raw.fontId)) {
        // Preserve an existing selection even when a malformed list is full.
        if (fonts.length === MAX_FONTS) fonts.pop();
        add({ id: raw.fontId, name: raw.fontName || '导入的字体' });
    }
    const selected = fonts.find(font => font.id === raw.fontId);
    const fontPreset = Object.hasOwn(FONT_PRESETS, raw.fontPreset) && (raw.fontPreset !== 'custom' || selected) ? raw.fontPreset : 'inherit';
    return { fonts, fontPreset, fontId: selected?.id ?? null, fontName: selected?.name ?? '' };
}

export async function loadBuiltinFont(id = 'genwan') {
    const preset = FONT_PRESETS[id];
    if (!preset?.file) throw new Error('这款字体没有内置文件。');
    const url = new URL(`./assets/fonts/${preset.file}`, import.meta.url).href;
    const face = new FontFace(`stm-${id}`, `url("${url}")`, { display: 'swap' });
    await face.load();
    return face;
}
export function validateFontFile(file) {
    if (!file || !/\.(woff2?|ttf|otf)$/i.test(file.name)) throw new Error('请选择 WOFF2、WOFF、TTF 或 OTF 字体文件。');
    if (!file.size || file.size > 20 * 1024 * 1024) throw new Error('字体文件不能为空，大小不能超过 20 MB。');
}
export async function decodeFont(blob, id) {
    const face = new FontFace(`stm-font-${id.replace(/[^a-f0-9]/g, '')}`, await blob.arrayBuffer());
    await face.load();
    return face;
}
