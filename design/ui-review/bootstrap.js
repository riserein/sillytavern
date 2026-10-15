// Design sandbox only. No SillyTavern account, production settings, IndexedDB or external API is used.
window.__PREVIEW_MODULE_URL__ = new URL('../../index.js', location.href).href;
window.__previewBlobs = new Map();
const exampleTone = (frequency) => {
    const rate = 8000, seconds = 36, samples = rate * seconds;
    const buffer = new ArrayBuffer(44 + samples * 2), view = new DataView(buffer);
    const text = (offset, value) => [...value].forEach((c, i) => view.setUint8(offset + i, c.charCodeAt(0)));
    text(0, 'RIFF'); view.setUint32(4, buffer.byteLength - 8, true); text(8, 'WAVE'); text(12, 'fmt ');
    view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
    view.setUint32(24, rate, true); view.setUint32(28, rate * 2, true); view.setUint16(32, 2, true);
    view.setUint16(34, 16, true); text(36, 'data'); view.setUint32(40, samples * 2, true);
    for (let i = 0; i < samples; i++) view.setInt16(44 + i * 2, Math.sin(i * Math.PI * 2 * frequency / rate) * 650, true);
    return new Blob([buffer], { type: 'audio/wav' });
};
const titles = ['雨落旧书页', '海岸来信', '未寄出的晚风', '灯火与长夜', '在世界另一端等一场春雨'];
const demoTracks = titles.map((title, i) => {
    const id = `preview-${i}`; window.__previewBlobs.set(id, exampleTone(220 + i * 55));
    return { id, kind: 'local', title, artist: '原型示例 · 合成音', fallbackCover: i % 3,
        lyrics: '[00:00]把喧嚣留在窗外\n[00:06]听雨落进旧书页\n[00:12]那些还没有说出口的话\n[00:18]让旋律慢慢写下来\n[00:24]晚风经过，灯火未眠\n[00:30]我们在故事里再见' };
});
demoTracks.push({ id: 'platform:netease:preview', kind: 'platform', platform: 'netease', platformTrackId: 'preview',
    title: '来源链接示例 · 暂不能直接播放', artist: '', metadataStatus: 'reference', playback: 'external', sourceUrl: 'https://music.163.com/song?id=123', fallbackCover: 1 });
const now = Date.now();
let previewSettings = { tracks: demoTracks, currentId: 'preview-0', volume: .16,
    panelSize: { width: innerWidth < 600 ? 351 : 640, height: Math.max(420, Math.min(700, innerHeight - 190)) },
    positions: { panel: { x: Math.max(8, (innerWidth - Math.min(640, innerWidth - 24)) / 2) / innerWidth, y: (innerWidth < 600 ? 172 : 154) / innerHeight }, launcher: null },
    theme: 'pearl', colorScheme: 'light', surface: 'matte', fontPreset: 'inherit',
    playlists: [
        { id: 'preview-night', name: '雨夜与旧书', trackIds: ['preview-0', 'preview-3', 'preview-4'], characterAvatars: ['preview-reader.png'], lastTrackId: 'preview-0' },
        { id: 'preview-sea', name: '向海而行', trackIds: ['preview-1', 'preview-2'], characterAvatars: [], lastTrackId: 'preview-1' },
    ], recentPlays: [{ trackId: 'preview-0', at: now - 600000 }, { trackId: 'preview-1', at: now - 1200000 }],
    playEvents: ['preview-0', 'preview-0', 'preview-1'].map((trackId, i) => ({ trackId, at: now - (i + 1) * 100000 })) };
const listeners = new Map();
const context = { extensionSettings: { riserein_music_player: previewSettings }, saveSettingsDebounced() {},
    characters: [{ name: '书店里的旅人', avatar: 'preview-reader.png' }, { name: '远航者', avatar: 'preview-sailor.png' }],
    characterId: undefined, eventTypes: { CHAT_CHANGED: 'chat', APP_READY: 'ready', CHARACTER_RENAMED: 'renamed' },
    eventSource: { on(type, callback) { const list = listeners.get(type) || []; list.push(callback); listeners.set(type, list); },
        async emit(type) { for (const callback of listeners.get(type) || []) await callback(); } } };
window.SillyTavern = { getContext: () => context };
window.__previewContext = context;
// This prototype is offline; never substitute invented successful upstream search results.
window.fetch = async () => { throw new Error('设计原型不联网，真实平台能力请使用正式插件检查。'); };
