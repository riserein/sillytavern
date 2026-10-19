/** WCAG relative luminance. Composite CSS alpha before comparison. */
export function colorChannels(value) {
  if (typeof value !== 'string') return null;
  const hex = value.trim().match(/^#([\da-f]{6}|[\da-f]{8})$/i);
  if (hex) return [0, 2, 4].map(at => parseInt(hex[1].slice(at, at + 2), 16)).concat(hex[1].length === 8 ? parseInt(hex[1].slice(6), 16) / 255 : 1);
  const rgb = value.trim().match(/^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:\s*[,/]\s*([\d.]+))?\s*\)$/);
  return rgb ? [Number(rgb[1]), Number(rgb[2]), Number(rgb[3]), rgb[4] === undefined ? 1 : Number(rgb[4])] : null;
}
export const colorHex = channels => '#' + channels.slice(0, 3).map(n => Math.round(Math.max(0, Math.min(255, n))).toString(16).padStart(2, '0')).join('');
export function compositeColor(foreground, background) {
  const a = colorChannels(foreground), b = colorChannels(background);
  if (!a || !b) throw new Error('不能解析用于对比度检查的颜色');
  return colorHex(a.slice(0, 3).map((n, i) => n * a[3] + b[i] * (1 - a[3])));
}
export const mixColor = (a, b, ratio) => colorHex(colorChannels(a).slice(0, 3).map((n, i) => n * (1 - ratio) + colorChannels(b)[i] * ratio));
export const luminance = (value) => {
  const rgba = colorChannels(value);
  if (!rgba || rgba[3] < 1) throw new Error('请先合成透明颜色，再检查有效背景');
  const c = rgba.slice(0, 3).map(n => n / 255)
    .map((n) => (n <= 0.04045 ? n / 12.92 : ((n + 0.055) / 1.055) ** 2.4));
  return c[0] * 0.2126 + c[1] * 0.7152 + c[2] * 0.0722;
};
export function contrastRatio(a, b) {
  return (Math.max(luminance(a), luminance(b)) + 0.05) / (Math.min(luminance(a), luminance(b)) + 0.05);
}
/** Display correction only: never overwrite author colors or locked values. */
export function readableColor(color, backgrounds, target = 4.5) {
  const score = c => Math.min(...backgrounds.map(bg => contrastRatio(c, bg)));
  const start = compositeColor(color, backgrounds[0]);
  if (score(start) >= target) return start;
  const end = score('#ffffff') >= score('#000000') ? '#ffffff' : '#000000';
  if (score(end) < target) return end;
  let low = 0, high = 1;
  for (let i = 0; i < 16; i++) { const mid = (low + high) / 2; if (score(mixColor(start, end, mid)) >= target) high = mid; else low = mid; }
  return mixColor(start, end, high);
}
export function readingPalette(source, level = 'clear') {
  const background = compositeColor(source.background, '#ffffff');
  let surface = background;
  if (level === 'high') {
    const ink = contrastRatio(background, '#000000') >= contrastRatio(background, '#ffffff') ? '#000000' : '#ffffff';
    surface = readableColor(background, [ink], 9);
  }
  const target = level === 'high' ? 9 : level === 'standard' ? 4.5 : 7;
  const body = readableColor(source.text, [surface], target);
  const secondary = readableColor(source.muted || source.text, [surface], level === 'high' ? 7 : 4.5);
  const accent = readableColor(source.accent, [surface], level === 'high' ? 7 : 4.5);
  const selected = mixColor(surface, accent, .1);
  return { background, surface, title: body, body, secondary, hint: secondary, button: body, disabled: mixColor(body, surface, .45), lyrics: body, current: accent, accent: readableColor(accent, [surface, selected], 4.5), selected, action: accent, onAction: readableColor('#ffffff', [accent], 4.5), error: readableColor('#dc555c', [surface], 4.5), warning: readableColor('#b57b35', [surface], 4.5) };
}
export function readabilityReport(source, components = {}) {
  const bg = compositeColor(source.background, '#ffffff');
  const checks = [
    ['正文', source.text, bg], ['辅助文字', source.muted || source.text, bg],
    ['歌词', source.text, bg], ['强调色与当前歌词', source.accent, bg],
    ['按钮文字', readableColor('#ffffff', [source.accent]), source.accent],
    ...Object.entries(components).filter(([id, v]) => ['title', 'artist', 'lyrics', 'queue', 'volume', 'controls'].includes(id) && v.color).map(([id, v]) => ['组件 ' + id, compositeColor(v.color + Math.round((v.opacity ?? 1) * 255).toString(16).padStart(2, '0'), bg), bg]),
  ];
  return checks.map(([name, foreground, background]) => ({ name, foreground: compositeColor(foreground, background), background, ratio: contrastRatio(compositeColor(foreground, background), background), target: 4.5 }));
}
export function readableColors(colors, locked = new Set()) {
  const next = { ...colors };
  if (contrastRatio(next.background, next.text) < 4.5) {
    if (!locked.has("text"))
      next.text =
        contrastRatio(next.background, "#f8f6f1") >
        contrastRatio(next.background, "#192124")
          ? "#f8f6f1"
          : "#192124";
    else if (!locked.has("background"))
      next.background =
        contrastRatio(next.text, "#f8f6f1") >
        contrastRatio(next.text, "#192124")
          ? "#f8f6f1"
          : "#192124";
  }
  for (const key of ['muted', 'accent']) if (next[key] && !locked.has(key)) next[key] = readableColor(next[key], [next.background], 4.5);
  return next;
}
