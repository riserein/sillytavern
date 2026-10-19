/** Portable data only: never accept browser storage keys or executable configuration. */
import { TRANSITION_DURATIONS } from '../listening.js';
import { normalizeReading } from '../ui/reading.js';
export const MAX_PACKAGE_BYTES = 30 * 1024 * 1024;
export const MAX_AUDIO_BYTES = 20 * 1024 * 1024;
export const CARD_THEMES = Object.freeze({
    british: { name: '英伦复古', accent: '#b89563', background: '#30291f', text: '#f3e7d4' },
    hongkong: { name: '港式黑金', accent: '#dfbc68', background: '#151515', text: '#f4ecd7' },
    grey: { name: '冷灰艺术', accent: '#9ebaca', background: '#242b32', text: '#e3e9ee' },
    minimal: { name: '现代极简', accent: '#476752', background: '#f3f4ef', text: '#26352b' },
});
const COLORS = { accent: '#b2c3b1', background: '#182220', text: '#e8eee6' };
export function portableAudio(value) {
    if (typeof value !== 'string') return null;
    if (
        /^data:audio\/(?:mpeg|mp3|wav|x-wav|wave|ogg|mp4|aac|flac|x-flac|webm|opus);base64,[A-Za-z0-9+/]+={0,2}$/.test(
            value,
        )
    )
        return value;
    return publicResource(value);
}
export function publicResource(value) {
    try {
        const url = new URL(value),
            host = url.hostname.toLowerCase().replace(/\.$/, '');
        if (
            url.protocol !== 'https:' ||
            url.username ||
            url.password ||
            url.hash ||
            host === 'localhost' ||
            !host.includes('.') ||
            /(?:\.local|\.localhost|\.internal|\.test|\.invalid)$/.test(host) ||
            /^\d+\.\d+\.\d+\.\d+$/.test(host) ||
            host.startsWith('[')
        )
            return null;
        if (
            [...url.searchParams.keys()].some((key) =>
                /^(?:expires?|expiry|token|signature|sign|auth|x-amz-.+|x-goog-.+)$/i.test(key),
            )
        )
            return null;
        return url.href;
    } catch {
        return null;
    }
}
export function portableImage(value) {
    return typeof value === 'string' &&
        /^data:image\/(?:png|jpeg|webp|gif|avif);base64,[A-Za-z0-9+/]+={0,2}$/.test(value)
        ? value
        : null;
}
export function normalizeAppearance(raw = {}) {
    const result = {};
    for (const key of ['accent', 'background', 'text'])
        result[key] = /^#[a-f\d]{6}$/i.test(raw[key]) ? raw[key] : COLORS[key];
    result.surface = ['matte', 'glass', 'clear'].includes(raw.surface) ? raw.surface : 'matte';
    result.opacity = Number.isFinite(raw.opacity) ? Math.max(0, Math.min(1, raw.opacity)) : 0.94;
    result.image = portableImage(raw.image) || '';
    if (result.surface === 'clear' && !result.image) result.surface = 'matte';
    result.fontFamily = ['system-ui, sans-serif', 'serif', 'sans-serif', 'KaiTi, serif'].includes(raw.fontFamily)
        ? raw.fontFamily
        : 'system-ui, sans-serif';
    if (
        typeof raw.font === 'string' &&
        /^data:(?:font\/(?:woff2?|ttf|otf)|application\/(?:font-woff|x-font-ttf|octet-stream));base64,[A-Za-z0-9+/]+={0,2}$/.test(
            raw.font,
        )
    )
        result.font = raw.font;
    result.fontLicense = String(raw.fontLicense || '').slice(0, 30000);
    result.fontName = String(raw.fontName || '').slice(0, 120);
    if(typeof raw.launcherIcon==='string'&&raw.launcherIcon.length<1500000&&/^data:image\/(?:png|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(raw.launcherIcon))result.launcherIcon=raw.launcherIcon;
    return result;
}
export function normalizeCardConfig(raw) {
    if (!raw || !/^[\w:-]{1,100}$/.test(raw.id || '')) throw new Error('播放器项目标识无效。');
    if (!Array.isArray(raw.tracks) || !raw.tracks.length || raw.tracks.length > 200)
        throw new Error('请选择 1 至 200 首歌曲。');
    const ids = new Set();
    const tracks = raw.tracks.map((track, index) => {
        const src = portableAudio(track.src);
        if (!src) throw new Error(`第 ${index + 1} 首歌没有可分发的音源，请使用本地音频或稳定的公开 HTTPS 直链。`);
        const id = String(track.id || index);
        if (ids.has(id)) throw new Error('导出歌曲标识重复。');
        ids.add(id);
        return {
            id,
            title: String(track.title || '未命名音乐').slice(0, 160),
            artist: String(track.artist || '').slice(0, 120),
            src,
            cover: portableImage(track.cover) || '',
            lyrics: String(track.lyrics || '').slice(0, 50000),
            ...(publicResource(track.lyricsSource) ? { lyricsSource: publicResource(track.lyricsSource) } : {}),
            sourceUrl: publicResource(track.sourceUrl) || '',
            attribution: String(track.attribution || '').slice(0, 1000),
        };
    });
    return {
        id: raw.id,
        title: String(raw.title || '我的音乐').slice(0, 80),
        demo: raw.demo === true,
        tracks,
        appearance: normalizeAppearance(raw.appearance),
        volume: Number.isFinite(raw.volume) ? Math.min(1, Math.max(0, raw.volume)) : 0.2,
        mode: ['sequence', 'list', 'single', 'shuffle'].includes(raw.mode) ? raw.mode : 'list',
        transitionDuration: TRANSITION_DURATIONS.includes(raw.transitionDuration) ? raw.transitionDuration : 300,
        reading: normalizeReading(raw.reading),
        startCollapsed: raw.startCollapsed === true,
    };
}
export function jsonForScript(value) {
    return JSON.stringify(value)
        .replace(/</g, '\\u003c')
        .replace(/\u2028/g, '\\u2028')
        .replace(/\u2029/g, '\\u2029');
}
