export const FONT_PRESETS = {
    inherit: { name: '跟随酒馆', family: 'inherit' },
    sans: { name: '清爽黑体', family: '"Noto Sans SC", "PingFang SC", "Microsoft YaHei", sans-serif' },
    song: { name: '典雅宋体', family: '"Noto Serif SC", "Songti SC", SimSun, serif' },
    kai: { name: '温润楷书', family: 'KaiTi, STKaiti, "Kaiti SC", serif' },
    fang: { name: '书卷仿宋', family: 'FangSong, STFangsong, serif' },
    genwan: { name: '源雲明體 · 内置', family: '"stm-genwan", "Noto Serif SC", SimSun, serif' },
    custom: { name: '导入的字体', family: 'inherit' },
};
export async function loadBuiltinFont() {
    const url = new URL('./assets/fonts/GenWanMin2TC-R.woff2', import.meta.url).href;
    const face = new FontFace('stm-genwan', `url("${url}")`, { display: 'swap' });
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
