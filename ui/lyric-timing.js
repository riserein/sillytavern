/** Positive calibration delays lyric highlighting; source LRC timestamps stay intact. */
export const normalizeLyricOffset = value => Number.isFinite(value) ? Math.max(-60000, Math.min(60000, Math.round(value))) : 0;
export function normalizeLyricOffsets(raw, ids) {
    return Object.fromEntries(Object.entries(raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {}).filter(([id, value]) => id.length <= 160 && (!ids || ids.has(id)) && Number.isFinite(value)).slice(0, 200).map(([id, value]) => [id, normalizeLyricOffset(value)]));
}
export const effectiveLyricOffset = (track, overrides) => normalizeLyricOffset(overrides?.[track?.id] ?? track?.lyricOffsetMs);
export function flowPosition(lines, centers, index, time) {
    if (index < 0) return centers[0] || 0;
    const next = lines[index + 1], start = lines[index]?.time;
    if (!next || !Number.isFinite(start) || next.time <= start) return centers[index] || 0;
    // Hold during a long interlude; move only through its final 2.5 seconds.
    const from = next.time - start > 8 ? next.time - 2.5 : start;
    const fraction = Math.min(1, Math.max(0, (time - from) / (next.time - from)));
    return centers[index] + (centers[index + 1] - centers[index]) * fraction;
}
